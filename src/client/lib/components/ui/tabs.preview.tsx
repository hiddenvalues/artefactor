import { definePreview } from "../../../design/preview";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

function Example({ variant }: { variant: "default" | "line" }) {
  return (
    <Tabs defaultValue="mine" className="w-96">
      <TabsList variant={variant}>
        <TabsTrigger value="mine">Your artefacts</TabsTrigger>
        <TabsTrigger value="shared">Shared with you</TabsTrigger>
        <TabsTrigger value="off" disabled>
          Disabled
        </TabsTrigger>
      </TabsList>
      <TabsContent value="mine" className="text-sm">
        Everything you own.
      </TabsContent>
      <TabsContent value="shared" className="text-sm">
        What others shared.
      </TabsContent>
    </Tabs>
  );
}

export default definePreview({
  title: "Tabs",
  variants: [
    { name: "Default", render: () => <Example variant="default" /> },
    { name: "Line", render: () => <Example variant="line" /> },
    {
      name: "Vertical",
      render: () => (
        <Tabs defaultValue="general" orientation="vertical">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="access">Access</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="text-sm">
            General settings.
          </TabsContent>
          <TabsContent value="access" className="text-sm">
            Access settings.
          </TabsContent>
        </Tabs>
      ),
    },
  ],
});
