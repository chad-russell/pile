import type { Sprite } from "./scenes";

const PILE_COLORS = ["#FFE14A", "#7ADFFF", "#C6F54E", "#FFB020", "#CBBDFF", "#FF7AA8", "#72F0C0", "#FF8D7A"];

function valueSize(text: string) {
  if (text.length <= 2) return "3.4rem";
  if (text.length <= 4) return "2.5rem";
  if (text.length <= 7) return "1.7rem";
  return "1.2rem";
}

/** Writes sprite data into a container, reusing one element per sprite key. */
export class SpriteLayer {
  private els = new Map<string, HTMLElement>();

  constructor(private container: HTMLElement) {}

  private create(sprite: Sprite): HTMLElement {
    const el = document.createElement("div");
    if (sprite.kind === "block") {
      el.className = "card";
      const n = PILE_COLORS.length;
      el.style.background = PILE_COLORS[((sprite.id % n) + n) % n]!;
      const value = document.createElement("span");
      value.className = "card-value";
      value.textContent = sprite.text;
      value.style.fontSize = valueSize(sprite.text);
      el.append(value);
    } else if (sprite.kind === "chip") {
      el.className = "chip";
      el.style.background = sprite.color;
    } else if (sprite.kind === "mark") {
      el.className = sprite.passed ? "mark is-pass" : "mark is-fail";
      el.textContent = sprite.passed ? "✓" : "✗";
    } else if (sprite.kind === "spark") {
      el.className = sprite.round ? "spark is-round" : "spark";
      el.style.background = sprite.color;
      el.style.setProperty("--size", `${sprite.size}px`);
    } else {
      el.className = "flash";
    }
    el.setAttribute("aria-hidden", "true");
    this.container.append(el);
    return el;
  }

  draw(sprites: Sprite[]) {
    const seen = new Set<string>();
    for (const sprite of sprites) {
      seen.add(sprite.key);
      let el = this.els.get(sprite.key);
      if (!el) {
        el = this.create(sprite);
        this.els.set(sprite.key, el);
      }
      const move = `translate3d(${sprite.x}px, ${sprite.y}px, 0) rotate(${sprite.rot}deg)`;
      if (sprite.kind === "spark" || sprite.kind === "flash" || sprite.kind === "mark") {
        el.style.transform = `${move} scale(${sprite.scale})`;
      } else {
        el.style.transform = `${move} scale(${sprite.sx}, ${sprite.sy})`;
        if (sprite.kind === "block") el.classList.toggle("is-top", sprite.top);
        else {
          el.classList.toggle("is-sad", sprite.sad);
          // Repeat × top relabels its block with the count it took.
          if (el.textContent !== sprite.label) {
            el.textContent = sprite.label;
            el.classList.toggle("is-word", sprite.label.length > 2);
          }
        }
      }
      el.style.opacity = String(sprite.opacity);
      el.style.zIndex = String(sprite.z);
    }
    for (const [key, el] of this.els) {
      if (!seen.has(key)) {
        el.remove();
        this.els.delete(key);
      }
    }
  }

  clear() {
    for (const el of this.els.values()) el.remove();
    this.els.clear();
  }
}
