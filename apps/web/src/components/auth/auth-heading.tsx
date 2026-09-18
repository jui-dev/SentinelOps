/** The title and one line of context at the top of a sign-in panel. */
export function AuthHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold tracking-[-0.01em] text-fg">
        {title}
      </h1>
      {description && <p className="text-sm text-fg-muted">{description}</p>}
    </div>
  );
}
