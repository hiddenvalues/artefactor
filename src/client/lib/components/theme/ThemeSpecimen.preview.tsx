import { definePreview } from "../../../design/preview";
import { ThemeSpecimen, type ThemeSection } from "./ThemeSpecimen";

const SECTIONS: [string, ThemeSection][] = [
  ["Colours", "colours"],
  ["Product colours", "product"],
  ["Type", "type"],
  ["Radius", "radius"],
  ["In use", "in-use"],
];

export default definePreview({
  title: "Theme specimen",
  variants: SECTIONS.map(([name, section]) => ({ name, render: () => <ThemeSpecimen section={section} /> })),
});
