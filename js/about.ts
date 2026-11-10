// Plays the About section's demo video while it is on screen (ADR 29).
const video = document.getElementById("about-video") as HTMLVideoElement | null;

if (video && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // A pause the observer did not cause is the viewer's: it stays until they press play again.
    let ownPause = false;
    let viewerPaused = false;
    video.addEventListener("pause", () => {
        viewerPaused = !ownPause;
        ownPause = false;
    });
    video.addEventListener("play", () => (viewerPaused = false));
    new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
            // A refused play() leaves the video stopped; its controls still work.
            if (!viewerPaused) video.play().catch(() => {});
        } else {
            ownPause = !video.paused;
            video.pause();
        }
    }).observe(video);
}
