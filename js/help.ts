// In-app help (ADR 26): the modal <dialog id="help"> in index.html. A #help-… address opens it at that section.
const dialog = document.getElementById("help") as HTMLDialogElement;
const show = () => !dialog.open && dialog.showModal();
/** The element the address fragment names, when it is inside the help. */
const target = () => {
    const el = document.getElementById(location.hash.slice(1));
    return el && dialog.contains(el) ? el : null;
};

function openAtFragment() {
    const el = target();
    if (!el) return;
    show();
    el.scrollIntoView();
}

document.getElementById("help-open")!.onclick = show;
// Closing drops the fragment, so the same link can open the help again.
dialog.addEventListener("close", () => target() && history.replaceState(null, "", location.pathname + location.search));
addEventListener("hashchange", openAtFragment);
openAtFragment();
export {};
