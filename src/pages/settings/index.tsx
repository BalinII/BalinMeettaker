import { Theme, AutostartToggle } from "./components";
import { PageLayout } from "@/layouts";

const Settings = () => {
  return (
    <PageLayout
      title="Settings"
      description="Configure the MinuteSmith desktop experience. Meeting capture, transcription, and summaries stay local-first."
    >
      <Theme />
      <AutostartToggle />
    </PageLayout>
  );
};

export default Settings;
