import { useState } from "react";
import { definePreview } from "../../design/preview";
import { VIS, VIS_ORDER, type Visibility } from "../format";
import { ChoiceList } from "./ChoiceList";

const choices = VIS_ORDER.map((v) => ({ value: v, ...VIS[v] }));

function Example({ bordered = false, initial }: { bordered?: boolean; initial: Visibility | undefined }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="w-80">
      <ChoiceList choices={choices} value={value} onChoose={setValue} bordered={bordered} />
    </div>
  );
}

export default definePreview({
  title: "Choice list",
  variants: [
    { name: "Plain", render: () => <Example initial="private" /> },
    { name: "Bordered (collection editor)", render: () => <Example bordered initial="authenticated" /> },
    { name: "Nothing chosen", render: () => <Example initial={undefined} /> },
  ],
});
