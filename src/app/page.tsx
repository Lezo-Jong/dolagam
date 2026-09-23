import { CreateRoomForm } from "@/components/CreateRoomForm";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <main className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            돌아가면요
          </h1>
          <p className="text-base text-zinc-600 dark:text-zinc-400">
            누가 할지, 공평하게 뽑아요.
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <CreateRoomForm />
        </div>

        <p className="text-center text-sm leading-6 text-zinc-500 dark:text-zinc-500">
          로그인 없이 링크로 바로 참여해요.
          <br />
          오래 안 뽑힐수록 다음에 뽑힐 확률이 올라가요.
        </p>
      </main>
    </div>
  );
}
