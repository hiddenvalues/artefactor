import { definePreview } from "../../design/preview";
import { artefact, noop } from "../../design/fixtures";
import { Launcher } from "../../design/Launcher";
import { FieldError, UploadDialog } from "./UploadDialog";

export default definePreview({
  title: "Upload dialog",
  variants: [
    {
      name: "New upload",
      render: () => (
        <Launcher label="Open upload" primary>
          {(close) => <UploadDialog editing={null} busy={false} serverError={null} onClose={close} onSubmit={close} />}
        </Launcher>
      ),
    },
    {
      name: "Editing an artefact",
      render: () => (
        <Launcher label="Open edit">
          {(close) => <UploadDialog editing={artefact()} busy={false} serverError={null} onClose={close} onSubmit={close} />}
        </Launcher>
      ),
    },
    {
      name: "Uploading (busy)",
      render: () => (
        <Launcher label="Open busy upload">
          {(close) => <UploadDialog editing={artefact()} busy serverError={null} onClose={close} onSubmit={noop} />}
        </Launcher>
      ),
    },
    {
      name: "Server error",
      render: () => (
        <Launcher label="Open with server error">
          {(close) => (
            <UploadDialog editing={null} busy={false} serverError="The file is larger than 100 MB." onClose={close} onSubmit={noop} />
          )}
        </Launcher>
      ),
    },
    { name: "Field error (inline)", render: () => <FieldError>Give your artefact a title.</FieldError> },
  ],
});
