// Plays the About section's demo video while it is on screen (ADR 29).
const video = document.getElementById("about-video") as HTMLVideoElement | null;

if (video && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    new IntersectionObserver(([entry]) => {
        // A refused play() leaves the video stopped; its controls still work.
        if (entry.isIntersecting) video.play().catch(() => {});
        else video.pause();
    }).observe(video);
}
