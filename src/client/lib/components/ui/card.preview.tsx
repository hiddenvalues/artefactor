import { definePreview } from "../../../design/preview";
import { Button } from "./button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";

export default definePreview({
  title: "Card",
  variants: [
    {
      name: "Full anatomy",
      render: () => (
        <Card className="w-80">
          <CardHeader>
            <CardTitle>Onboarding flow</CardTitle>
            <CardDescription>A clickable prototype of the first-run experience.</CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm">
                Edit
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="text-sm">Last updated 3 hours ago.</CardContent>
          <CardFooter className="gap-2">
            <Button size="sm">Open</Button>
            <Button size="sm" variant="outline">
              Share
            </Button>
          </CardFooter>
        </Card>
      ),
    },
    {
      name: "Content only",
      render: () => (
        <Card className="w-80">
          <CardContent className="text-sm">A card with nothing but content.</CardContent>
        </Card>
      ),
    },
  ],
});
