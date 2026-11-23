(function (root) {
  'use strict';

  const CHARACTER_MS = 48;
  const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });

  function create(element, playCharacter) {
    const revealed = element.querySelector('.dialogue-revealed');
    const remaining = element.querySelector('.dialogue-remaining');
    const readable = element.querySelector('.dialogue-readable');
    const action = element.querySelector('.dialogue-action');

    let lines = [];
    let lineIndex = 0;
    let characters = [];
    let visibleCount = 0;
    let elapsed = 0;

    function render() {
      revealed.textContent = characters.slice(0, visibleCount).join('');
      remaining.textContent = characters.slice(visibleCount).join('');
      action.textContent = visibleCount < characters.length ? '건너뛰기' : '계속';
    }

    function showLine() {
      const text = lines[lineIndex];
      characters = Array.from(segmenter.segment(text), ({ segment }) => segment);
      visibleCount = 0;
      elapsed = 0;
      readable.textContent = text;
      render();
    }

    function open(sequence) {
      if (sequence.length === 0) return;
      lines = sequence;
      lineIndex = 0;
      element.hidden = false;
      showLine();
    }

    function update(milliseconds) {
      if (element.hidden || visibleCount === characters.length) return;
      elapsed += milliseconds;
      if (elapsed < CHARACTER_MS) return;

      // Reveal at most one character per frame so their tones stay separate after a stall.
      elapsed %= CHARACTER_MS;
      const character = characters[visibleCount++];
      render();
      if (character.trim()) playCharacter(character);
    }

    function next() {
      if (element.hidden) return;
      if (visibleCount < characters.length) {
        visibleCount = characters.length;
        render();
      } else if (lineIndex + 1 < lines.length) {
        lineIndex += 1;
        showLine();
      } else {
        element.hidden = true;
      }
    }

    return { get active() { return !element.hidden; }, open, update, next };
  }

  root.DormDialogue = { create };
})(globalThis);
