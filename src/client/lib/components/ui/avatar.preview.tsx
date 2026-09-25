import { definePreview } from "../../../design/preview";
import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount } from "./avatar";

const SIZES = ["sm", "default", "lg"] as const;

export default definePreview({
  title: "Avatar",
  variants: [
    {
      name: "Sizes",
      render: () =>
        SIZES.map((s) => (
          <Avatar key={s} size={s}>
            <AvatarFallback>AL</AvatarFallback>
          </Avatar>
        )),
    },
    {
      name: "With badge",
      render: () => (
        <Avatar size="lg">
          <AvatarFallback>GH</AvatarFallback>
          <AvatarBadge />
        </Avatar>
      ),
    },
    {
      name: "Group",
      render: () => (
        <AvatarGroup>
          {["AL", "GH", "AT"].map((i) => (
            <Avatar key={i}>
              <AvatarFallback>{i}</AvatarFallback>
            </Avatar>
          ))}
          <AvatarGroupCount>+4</AvatarGroupCount>
        </AvatarGroup>
      ),
    },
  ],
});
