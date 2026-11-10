// Playable client: wires the lobby, the waiting room and the game (ADR 7, 12, 14, 15).
import init from "../pkg/index.js";
import { BUILD_ID, BUILD_VERSION, parseInvite } from "./net";
import { $ } from "./dom";
import { clearEnded, end, ended, play } from "./game";
import { enterRoom, MISMATCH, room, SEAT_KEY, toLobby } from "./room";
import type { Seat } from "./room";
import { showError } from "./status";
import "./help";
import "./about";

// Fetches `index_bg.wasm`, which sits next to the bundle in dist/.
await init();

/** An invite from another build: the fragment is already gone, so the link has to be opened again. */
const INVITE_MISMATCH = ["Different version.", "Reload the page, then open the invite link again."] as const;
/** An invite opened while this page is in a game or a waiting room (ADR 24). */
const BUSY = "Finish or leave this game first, then open the invite link again.";

$("build").textContent = `v ${BUILD_VERSION}`;
$("build").setAttribute("aria-label", `v ${BUILD_VERSION}, changelog, opens in a new tab`);

/**
 * Joins the game an invite link names (ADR 24), and first takes the link out of the address bar so
 * a screenshot or a shared URL does not show the key. Returns false when the address holds none.
 */
function openInvite() {
    const invite = parseInvite(location.hash);
    if (!invite) return false;
    history.replaceState(null, "", location.pathname + location.search);
    if (invite.version === BUILD_ID) enterRoom(invite.hostId, undefined, invite.key);
    else end(...INVITE_MISMATCH);
    return true;
}
// A link pasted into this tab changes only the fragment, which does not reload the page.
addEventListener("hashchange", () => {
    if (!parseInvite(location.hash)) return;
    if (room && !ended) {
        // This page stays where it is. The key still goes from the address bar, or a reload would
        // follow the link instead of rejoining our seat (ADR 16).
        history.replaceState(null, "", location.pathname + location.search);
        if (play) showError(BUSY, false);
        else $("room-error").textContent = BUSY;
        return;
    }
    toLobby();
    // The last game's end must not swallow this one's (a version mismatch ends at once).
    clearEnded();
    openInvite();
});

// After a reload, rejoin the game we hold a seat in (ADR 16); an invite opened in this tab wins over it.
const saved = sessionStorage.getItem(SEAT_KEY);
if (!openInvite() && saved) {
    const seat = JSON.parse(saved) as Seat;
    if (seat.version === BUILD_ID) enterRoom(seat.hostId, seat);
    else end(...MISMATCH);
}
