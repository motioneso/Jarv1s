const TRIGGER_PHRASES = [
  // deadline
  "by friday", "by monday", "by tuesday", "by wednesday", "by thursday",
  "by end of", "before the deadline", "due date", "due by", "by eod", "by eow",
  "by next week", "by tomorrow", "by tonight", "by morning", "by afternoon",
  // promise / intent
  "i'll send", "i will send", "i'll get", "i will get", "i'll do", "i will do",
  "i'll follow", "i will follow", "i promise", "i'll make sure", "i will make sure",
  "i'll let you know", "i'll check", "i will check", "i'll share", "i'll update",
  "i'll complete", "i'll finish", "will deliver", "i'll deliver",
  // obligation
  "i need to", "i must", "i have to", "i should", "i'm required", "i am required",
  "need to submit", "need to complete", "need to review", "need to send",
  // explicit
  "action item", "action required", "to-do", "todo", "following up on",
  "take care of", "make sure to", "don't forget to", "remember to",
  "commit to", "committed to", "agreed to"
];

export function passesPrefilter(text: string): boolean {
  const lower = text.toLowerCase();
  return TRIGGER_PHRASES.some((phrase) => lower.includes(phrase));
}
