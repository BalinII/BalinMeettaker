import { Card, CardContent, CardDescription, CardTitle } from "./ui";

const Contribute = () => {
  return (
    <Card className="w-full">
      <CardContent className="flex flex-col gap-2 p-4 py-0">
        <CardTitle className="text-xs lg:text-sm">
          Local-first prototype
        </CardTitle>
        <CardDescription className="text-[10px] lg:text-xs">
          MinuteSmith keeps meeting notes and settings local by default. Configure your own providers in Dev Space when you want AI assistance.
        </CardDescription>
      </CardContent>
    </Card>
  );
};

export default Contribute;
