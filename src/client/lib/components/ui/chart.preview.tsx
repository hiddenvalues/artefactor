import { Bar, BarChart, Line, LineChart, XAxis } from "recharts";
import { definePreview } from "../../../design/preview";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "./chart";

const DATA = [
  { month: "Jan", total: 12 },
  { month: "Feb", total: 19 },
  { month: "Mar", total: 15 },
  { month: "Apr", total: 26 },
  { month: "May", total: 31 },
  { month: "Jun", total: 22 },
];

const config = { total: { label: "Created", color: "var(--ring)" } } satisfies ChartConfig;

export default definePreview({
  title: "Chart",
  variants: [
    {
      name: "Bar, with tooltip",
      render: () => (
        <ChartContainer config={config} className="h-48 w-96">
          <BarChart data={DATA} accessibilityLayer>
            <XAxis dataKey="month" tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="total" fill="var(--color-total)" radius={4} />
          </BarChart>
        </ChartContainer>
      ),
    },
    {
      name: "Sparkline",
      render: () => (
        <ChartContainer config={config} className="aspect-auto h-8 w-28">
          <LineChart data={DATA}>
            <Line dataKey="total" stroke="var(--color-total)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ChartContainer>
      ),
    },
  ],
});
