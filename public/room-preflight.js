// Keep a returning visitor's server-rendered form out of view until their
// browser-only chat key is restored. New visitors see the form immediately.
try {
  const rooms = JSON.parse(window.localStorage.getItem("dkb_chat_rooms") || "[]");
  if (
    Array.isArray(rooms) &&
    rooms.some(
      (room) =>
        room &&
        typeof room.roomId === "string" &&
        typeof room.token === "string" &&
        (!room.expiresAt || new Date(room.expiresAt).getTime() > Date.now()),
    )
  ) {
    document.documentElement.dataset.roomPending = "true";
    // If the app fails to hydrate, leave the page usable instead of blank.
    window.setTimeout(() => document.documentElement.removeAttribute("data-room-pending"), 8000);
  }
} catch {
  // Invalid or inaccessible storage behaves like a new visit.
}
