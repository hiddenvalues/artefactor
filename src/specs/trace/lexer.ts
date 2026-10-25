// A small lexer for the scanned files: it finds comments (where references live) and the title
// strings of `it` / `test` / `describe` calls, and skips string, template and regex literals so a
// fixture string that *contains* `// r[verify …]` is never read as a reference. It is a heuristic
// sized to this repo's code, not a parser: a quote in JSX text opens a string that ends at the line
// break, so the damage stops there.
import type { SourceFile } from "./model";

export interface CommentLine {
  /** The comment's text on this line, leader included. */
  text: string;
  line: number;
}

export interface TestTitle {
  fn: "it" | "test" | "describe";
  text: string;
  /** The line of the call (`it(`), which a `// r[verify …]` sits directly above. */
  line: number;
  /** Leading whitespace of the call's line, for nesting. */
  indent: number;
}

export interface Lexed {
  comments: CommentLine[];
  titles: TestTitle[];
  /** Lines holding a comment and no code. */
  commentOnly: Set<number>;
}

type Language = "js" | "sql" | "hash";

const languageOf = (path: string): Language =>
  /\.(ts|tsx|js|mjs)$/.test(path) ? "js" : path.endsWith(".sql") ? "sql" : "hash";

export function lex(file: SourceFile): Lexed {
  const language = languageOf(file.path);
  return language === "hash" ? lexHash(file.text) : lexC(file.text, language);
}

/** Shell, YAML and Dockerfiles: a `#` at the start of a line or after whitespace. */
function lexHash(text: string): Lexed {
  const comments: CommentLine[] = [];
  const commentOnly = new Set<number>();
  text.split(/\r?\n/).forEach((content, i) => {
    const hash = /(^|\s)#/.exec(content);
    if (!hash) return;
    const start = hash.index + hash[1]!.length;
    comments.push({ text: content.slice(start), line: i + 1 });
    if (content.slice(0, start).trim() === "") commentOnly.add(i + 1);
  });
  return { comments, titles: [], commentOnly };
}

/** The call a title string is the first argument of: `it(`, `describe.skip(`, `it.each([…])(`. */
const TITLE_CALL =
  /(?<![.\w$])(it|test|describe)(?:\.[A-Za-z]+)*(?:\((?:[^()]|\([^()]*\))*\))?\s*\(\s*$/;
/** After one of these, a `/` starts a regex literal rather than a division. */
const REGEX_AFTER = /(^|[(,=:[!&|?{};+\-*%<>~^]|\b(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await))\s*$/;

/** TypeScript (`//`, `/* *\/`, strings, templates, regexes) and SQL (`--`, `/* *\/`, strings). */
function lexC(text: string, language: "js" | "sql"): Lexed {
  const comments: CommentLine[] = [];
  const titles: TestTitle[] = [];
  const commentOnly = new Set<number>();
  const codeLines = new Set<number>();
  const lines = text.split(/\r?\n/);
  /** Recent code, with each literal reduced to `""`, for title and regex detection. */
  let tail = "";
  /** Open template literals and plain braces inside their `${…}`. */
  const stack: ("template" | "brace")[] = [];
  let line = 1;
  let i = 0;

  const code = (s: string) => {
    tail = (tail + s).slice(-400);
    if (s.trim() !== "") codeLines.add(line);
  };
  const comment = (s: string, at: number) => {
    comments.push({ text: s, line: at });
  };
  const title = (value: string) => {
    const call = TITLE_CALL.exec(tail);
    if (!call) return;
    const callLine = line - (call[0].match(/\n/g)?.length ?? 0);
    const indent = /^\s*/.exec(lines[callLine - 1] ?? "")![0].length;
    titles.push({ fn: call[1] as TestTitle["fn"], text: value, line: callLine, indent });
  };

  /** Reads template text from `i` to its closing backtick or a `${`; returns the text. */
  const readTemplate = (): string => {
    let value = "";
    while (i < text.length) {
      const c = text[i]!;
      if (c === "\\") {
        value += text.slice(i, i + 2);
        i += 2;
      } else if (c === "`") {
        i++;
        stack.pop();
        return value;
      } else if (c === "$" && text[i + 1] === "{") {
        i += 2;
        return value;
      } else {
        if (c === "\n") line++;
        else codeLines.add(line);
        value += c;
        i++;
      }
    }
    return value;
  };

  while (i < text.length) {
    const c = text[i]!;
    const next = text[i + 1];
    if (c === "\n") {
      line++;
      tail += "\n";
      i++;
    } else if ((language === "js" && c === "/" && next === "/") || (language === "sql" && c === "-" && next === "-")) {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      comment(text.slice(i, stop), line);
      if (!codeLines.has(line)) commentOnly.add(line);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      text
        .slice(i, stop)
        .split("\n")
        .forEach((part, k) => {
          comment(part, line + k);
          if (k > 0 || !codeLines.has(line)) commentOnly.add(line + k);
        });
      line += (text.slice(i, stop).match(/\n/g) ?? []).length;
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let value = "";
      while (j < text.length && text[j] !== c && text[j] !== "\n") {
        if (text[j] === "\\") {
          value += text.slice(j, j + 2);
          j += 2;
        } else {
          value += text[j];
          j++;
        }
      }
      codeLines.add(line);
      title(value);
      tail += '""';
      i = text[j] === c ? j + 1 : j;
    } else if (language === "js" && c === "`") {
      codeLines.add(line);
      i++;
      stack.push("template");
      const startTail = tail;
      const value = readTemplate();
      tail = startTail;
      title(value);
      tail += '""';
    } else if (language === "js" && c === "{" && stack.length > 0) {
      stack.push("brace");
      code(c);
      i++;
    } else if (language === "js" && c === "}" && stack.length > 0) {
      i++;
      if (stack[stack.length - 1] === "brace") {
        stack.pop();
        code(c);
      } else {
        readTemplate();
      }
    } else if (language === "js" && c === "/" && REGEX_AFTER.test(tail)) {
      let j = i + 1;
      let inClass = false;
      while (j < text.length && text[j] !== "\n") {
        const r = text[j]!;
        if (r === "\\") j++;
        else if (r === "[") inClass = true;
        else if (r === "]") inClass = false;
        else if (r === "/" && !inClass) break;
        j++;
      }
      codeLines.add(line);
      tail += '""';
      i = j + 1;
    } else {
      code(c);
      i++;
    }
  }
  return { comments, titles, commentOnly };
}
