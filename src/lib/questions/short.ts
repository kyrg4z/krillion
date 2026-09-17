import type { CategoryId, ShortSeedQuestion } from "../types";

/** Typed-answer questions. Matching is exact, then alias, then one typo per five characters. */
export const shortQuestions: (ShortSeedQuestion & { category: CategoryId })[] = [
  {
    id: "sh-ph-001", category: "physics", topic: "waves", d: 1,
    q: "Name the effect that changes the pitch you hear as a siren passes you.",
    answer: "Doppler effect", alias: ["doppler", "doppler shift", "the doppler effect"],
    why: "Relative motion compresses the arriving wavefronts ahead and stretches them behind.",
  },
  {
    id: "sh-ph-002", category: "physics", topic: "induction", d: 2,
    q: "Whose law says an induced current opposes the change that produced it?",
    answer: "Lenz", alias: ["lenz's law", "lenzs law", "lenz law", "heinrich lenz"],
    why: "It is conservation of energy in disguise — you must do work against the opposition.",
  },
  {
    id: "sh-ph-003", category: "physics", topic: "modern physics", d: 2,
    q: "What particle carries the electromagnetic force?",
    answer: "Photon", alias: ["photons", "the photon"],
    why: "Massless, so it travels at c and the force it carries has unlimited range.",
  },
  {
    id: "sh-rf-001", category: "rf", topic: "dB and dBm", d: 1,
    q: "How many decibels correspond to doubling the power?",
    answer: "3", alias: ["3 db", "three", "three db", "3db"],
    why: "Ten decibels is a factor of ten; three is very close to a factor of two.",
  },
  {
    id: "sh-rf-002", category: "rf", topic: "antennas", d: 2,
    q: "What is the usual characteristic impedance of radio coax, in ohms?",
    answer: "50", alias: ["50 ohms", "50 ohm", "fifty"],
    why: "A compromise between the lowest-loss geometry and the highest power-handling one.",
  },
  {
    id: "sh-rf-003", category: "rf", topic: "SDR", d: 2,
    q: "What is the name for high frequencies masquerading as low ones when you sample too slowly?",
    answer: "Aliasing", alias: ["alias", "aliassing", "an alias"],
    why: "An anti-aliasing filter ahead of the converter is what prevents it.",
  },
  {
    id: "sh-ce-001", category: "compeng", topic: "serial buses", d: 2,
    q: "Which two-wire bus uses addresses, open-drain lines and pull-up resistors?",
    answer: "I2C", alias: ["i²c", "i2c bus", "iic", "i 2 c", "i squared c"],
    why: "Open-drain drivers let many devices share two wires and stretch the clock.",
  },
  {
    id: "sh-ce-002", category: "compeng", topic: "digital logic", d: 2,
    q: "Which gate is functionally complete, meaning every other gate can be built from it?",
    answer: "NAND", alias: ["nand gate", "a nand gate", "nor", "nor gate"],
    why: "NOR works too, which is why whole logic families are built from one cell.",
  },
  {
    id: "sh-ce-003", category: "compeng", topic: "memory", d: 2,
    q: "Which memory type needs constant refreshing because each bit is charge on a capacitor?",
    answer: "DRAM", alias: ["dynamic ram", "d ram"],
    why: "One transistor and one capacitor per bit makes it dense, cheap and leaky.",
  },
  {
    id: "sh-ec-001", category: "economics", topic: "scarcity and choice", d: 1,
    q: "What is the value of the best alternative you gave up called?",
    answer: "Opportunity cost", alias: ["opportunity costs", "the opportunity cost"],
    why: "It counts whether or not money changed hands, which is what makes it useful.",
  },
  {
    id: "sh-ec-002", category: "economics", topic: "monetary policy", d: 2,
    q: "Which institution sets Canada's overnight interest rate target?",
    answer: "Bank of Canada", alias: ["the bank of canada", "boc", "banque du canada"],
    why: "It aims at 2% inflation, the midpoint of a 1 to 3 percent band.",
  },
  {
    id: "sh-hi-001", category: "history", topic: "Second World War", d: 1,
    q: "In which year did the Second World War end in Europe?",
    answer: "1945", alias: ["nineteen forty five", "45"],
    why: "Victory in Europe was declared on 8 May; Japan surrendered in September.",
  },
  {
    id: "sh-hi-002", category: "history", topic: "Canada", d: 2,
    q: "In which year did Canadian Confederation take effect?",
    answer: "1867", alias: ["eighteen sixty seven"],
    why: "The British North America Act joined four provinces on 1 July.",
  },
  {
    id: "sh-ge-001", category: "geography", topic: "capitals", d: 1,
    q: "What is the capital of Canada?",
    answer: "Ottawa", alias: ["ottawa ontario"],
    why: "Chosen by Queen Victoria in 1857, partly because it sat safely back from the border.",
  },
  {
    id: "sh-ge-002", category: "geography", topic: "rivers", d: 2,
    q: "Which river carries more water to the sea than any other?",
    answer: "Amazon", alias: ["the amazon", "amazon river", "rio amazonas"],
    why: "About a fifth of all river discharge on Earth.",
  },
  {
    id: "sh-gk-001", category: "general", topic: "space", d: 1,
    q: "Which planet is closest to the Sun?",
    answer: "Mercury", alias: ["planet mercury"],
    why: "Hot on the day side, but Venus is hotter overall thanks to its atmosphere.",
  },
  {
    id: "sh-gk-002", category: "general", topic: "computing", d: 2,
    q: "What does DNS translate a domain name into?",
    answer: "IP address", alias: ["an ip address", "ip", "internet protocol address"],
    why: "Routing moves the packets; DNS is the directory that tells you where to send them.",
  },
  {
    id: "sh-gk-003", category: "general", topic: "science", d: 2,
    q: "Which scientist published On the Origin of Species?",
    answer: "Darwin", alias: ["charles darwin", "c darwin"],
    why: "Published in 1859, after Wallace had reached similar conclusions independently.",
  },
];
