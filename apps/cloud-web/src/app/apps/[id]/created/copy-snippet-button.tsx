"use client";

export function CopySnippetButton({ snippet }: { snippet: string }) {
  return (
    <button
      className="au-btn au-btn-secondary"
      type="button"
      onClick={() => navigator.clipboard.writeText(snippet)}
    >
      Copy snippet
    </button>
  );
}
