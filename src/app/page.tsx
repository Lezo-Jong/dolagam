import { NewRoomWizard } from "@/components/NewRoomWizard";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <main className="flex w-full max-w-sm flex-col gap-8">
        <NewRoomWizard />
      </main>
    </div>
  );
}
