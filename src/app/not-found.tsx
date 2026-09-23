import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        방을 찾을 수 없어요
      </h1>
      <p className="text-base text-zinc-600 dark:text-zinc-400">
        링크가 잘못됐거나 방이 삭제됐어요.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        새 방 만들기
      </Link>
    </div>
  );
}
