export function stripAnsi(text) {
  text = String(text ?? "");
  const parts = [];
  let plain = 0;
  let noOscTerminatorFrom = Infinity;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\u001b") continue;
    let end = -1;
    const next = text[index + 1];
    if (next === "]") {
      if (index + 2 < noOscTerminatorFrom) {
        let cursor = index + 2;
        while (cursor < text.length) {
          if (text[cursor] === "\u0007") {
            end = cursor;
            break;
          }
          if (text[cursor] === "\u001b" && text[cursor + 1] === "\\") {
            end = cursor + 1;
            break;
          }
          cursor += 1;
        }
        if (end === -1) noOscTerminatorFrom = index + 2;
      }
    } else if (next === "[") {
      let cursor = index + 2;
      while (cursor < text.length) {
        const code = text.charCodeAt(cursor);
        if (
          (code >= 48 && code <= 63) ||
          (code >= 32 && code <= 47)
        )
          cursor += 1;
        else break;
      }
      if (cursor < text.length) {
        const code = text.charCodeAt(cursor);
        // ECMA-48 CSI final bytes are the complete 0x40–0x7E range, not only letters.
        if (code >= 0x40 && code <= 0x7e) end = cursor;
      }
    }
    if (end === -1) continue;
    parts.push(text.slice(plain, index));
    plain = end + 1;
    index = end;
  }
  parts.push(text.slice(plain));
  return parts.join("");
}
