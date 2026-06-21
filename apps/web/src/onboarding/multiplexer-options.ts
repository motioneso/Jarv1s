export const OPTIONS = [
  {
    id: "auto",
    name: "Auto",
    mono: "recommended",
    desc: "Detect and use the best available multiplexer on your computer."
  },
  {
    id: "tmux",
    name: "tmux",
    mono: "multiplexer",
    desc: "A standard terminal multiplexer. Must be installed on your computer."
  }
] as const;
