export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <p className="mb-6 text-lg font-semibold tracking-tight">SentinelOps</p>
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {children}
      </div>
    </main>
  );
}
