import { PageLayout } from "@/layouts";
import { Usage } from "./components";

const Dashboard = () => {
  return (
    <PageLayout
      title="Dashboard"
      description="MinuteSmith is a local-first meeting notes prototype. Configure local or custom providers in Dev Space and keep your notes in SQLite."
    >
      <Usage
        loading={false}
        onRefresh={() => undefined}
        data={[]}
        totalTokens={0}
      />
    </PageLayout>
  );
};

export default Dashboard;
