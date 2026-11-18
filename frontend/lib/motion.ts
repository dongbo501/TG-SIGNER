"use client";
import { useEffect, useState } from "react";
export function useMotion() {
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    try {
      setPaused(localStorage.getItem("tg-signer-motion") === "paused");
    } catch {}
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.motion =
      paused || reduced ? "paused" : "running";
  }, [paused, reduced]);
  const toggleMotion = () =>
    setPaused((value) => {
      try {
        localStorage.setItem("tg-signer-motion", value ? "running" : "paused");
      } catch {}
      return !value;
    });
  return { paused: paused || reduced, reduced, toggleMotion };
}
