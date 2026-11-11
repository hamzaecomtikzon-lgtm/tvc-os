const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Render Discord-flavoured markdown to an HTML string, as the post will look.
 * Input is escaped first, so the result is safe for dangerouslySetInnerHTML.
 */
export function discordMd(t) {
  return String(t || "")
    .split("\n")
    .map((line) => {
      const h = esc(line)
        .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
        .replace(/&lt;@!?(\d+)&gt;/g, '<span class="ment">@member</span>')
        .replace(/`(@here|@everyone)`/g, '<span class="ment">$1</span>')
        .replace(/(^|\s)(@here|@everyone)(?=\s|$)/g, '$1<span class="ment">$2</span>')
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
      if (/^# /.test(line)) return `<span class="h1">${h.slice(2)}</span>`;
      if (/^-# /.test(line)) return `<span class="sub">${h.slice(3)}</span>`;
      return h + "\n";
    })
    .join("");
}

export const draftMsgs = (d) => (Array.isArray(d.messages) && d.messages.length ? d.messages : [{ text: d.text || "" }]);
