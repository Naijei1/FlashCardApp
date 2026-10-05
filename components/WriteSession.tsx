"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { previewIntervals } from "@/lib/fsrs";
import { checkPinyinAnswer, numberedPinyin } from "@/lib/pinyin";
import { checkAnswer, diffChars, toWritePrompt, type DiffChar } from "@/lib/write";
import HardWordButton from "./HardWordButton";
import { IconCheck, IconX } from "./icons";
import RatingBar from "./RatingBar";
import { QueueStatus, SessionHeader, SessionScreen } from "./SessionChrome";
import TtsButton from "./TtsButton";
import { useKeyboard } from "./useKeyboard";
import { useStudyQueue } from "./useStudyQueue";

const REPEAT_MISTAKES_KEY = "flashcards.repeat-mistakes.v1";
const CORRECTION_COPIES = 3;

type Result = {
  correct: boolean;
  typed: DiffChar[];
  expected: DiffChar[];
};

export default function WriteSession({
  mode = "write",
  deckId,
  chineseLang,
  backHref,
}: {
  mode?: "write" | "pinyin";
  deckId: string;
  chineseLang: string;
  backHref: string;
}) {
  const study = useStudyQueue({ deckId, mode });
  const { current, submitRating } = study;
  const [value, setValue] = useState("");
  const [showEnglish, setShowEnglish] = useState(false);
  const [checkTones, setCheckTones] = useState(true);
  const [repeatMistakes, setRepeatMistakes] = useState(false);
  const [copiesLeft, setCopiesLeft] = useState(0);
  const [drillFailed, setDrillFailed] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const checkedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { setRepeatMistakes(localStorage.getItem(REPEAT_MISTAKES_KEY) === "true"); } catch {}
  }, []);

  const prompt = useMemo(() => {
    if (!current?.pinyin) return null;
    if (mode === "pinyin") {
      return { prompt: current.pinyin.hanzi, answer: current.pinyin.syllables.join(" "), notes: current.card.notes };
    }
    return current.chineseSide ? toWritePrompt(current.card, current.chineseSide, current.pinyin.syllables) : null;
  }, [current, mode]);

  const check = useCallback(
    (giveUp = false) => {
      if (!prompt || result || checkedRef.current) return;
      checkedRef.current = true;
      const typed = giveUp ? "" : value;
      const correct = mode === "pinyin"
        ? checkPinyinAnswer(typed, current?.pinyin?.syllables ?? [], checkTones)
        : checkAnswer(typed, prompt.answer);
      navigator.vibrate?.(10);
      // Numbered and marked answers can be equivalent without sharing literal
      // characters. Show the complete suggested reading for Pinyin feedback.
      const feedback = mode === "pinyin"
        ? {
            typed: [...typed].map((char) => ({ char, ok: correct })),
            expected: [...prompt.answer].map((char) => ({ char, ok: correct })),
          }
        : diffChars(typed, prompt.answer);
      if (repeatMistakes && !correct && !drillFailed) {
        setDrillFailed(true);
        setCopiesLeft(CORRECTION_COPIES);
      } else if (drillFailed && correct) {
        setCopiesLeft((left) => Math.max(0, left - 1));
      }
      setResult({ correct, ...feedback });
    },
    [checkTones, current?.pinyin, mode, prompt, result, value, repeatMistakes, drillFailed]
  );

  const rate = useCallback(
    (rating: number) => {
      if (!result || copiesLeft > 0) return;
      // The initial miss is the memory event. Copying the answer three times
      // must not turn it into three successful spaced reviews.
      const next = submitRating(drillFailed ? 1 : rating);
      if (!next) return;
      setResult(null);
      setValue("");
      setShowEnglish(false);
      setCopiesLeft(0);
      setDrillFailed(false);
      checkedRef.current = false;
      // Called from a tap/keypress, so refocusing keeps the keyboard up on iOS.
      if (next.length > 0) inputRef.current?.focus();
    },
    [copiesLeft, drillFailed, result, submitRating]
  );

  const defaultRating = drillFailed ? 1 : result ? (result.correct ? 3 : 1) : 3;
  function continueWriting() {
    if (copiesLeft > 0) {
      checkedRef.current = false;
      setResult(null);
      setValue("");
      inputRef.current?.focus();
    } else rate(defaultRating);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // Never treat the Enter that confirms a pinyin/IME candidate as a submit.
    if (event.defaultPrevented || event.repeat || event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }
    if (!result) {
      if (event.key === "Enter" && value.trim()) {
        event.preventDefault();
        check();
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      continueWriting();
    } else if (["1", "2", "3", "4"].includes(event.key)) {
      event.preventDefault();
      rate(Number(event.key));
    }
  }

  // Same shortcuts when focus is outside the input (the hook skips form fields).
  useKeyboard((event) => {
    if (!result) return;
    if (event.key === "Enter") {
      event.preventDefault();
      continueWriting();
    } else if (["1", "2", "3", "4"].includes(event.key)) {
      event.preventDefault();
      rate(Number(event.key));
    }
  });

  const status = (
    <QueueStatus study={study} backHref={backHref} copy={{
      noun: mode === "pinyin" ? "Pinyin" : "writing",
      verb: "wrote",
      empty: mode === "pinyin"
        ? "No cards with recognizable Chinese characters are due. Add Chinese to either side of a card, or come back later."
        : "No cards with a Pinyin reading are due right now — come back later.",
    }} />
  );
  if (!current) return status;
  if (!prompt) {
    return (
      <SessionScreen backHref={backHref} title="Nothing writable"
        body={mode === "pinyin" ? "No cards in this batch have a Pinyin reading available." : "No cards in this batch have a Chinese answer to write."}
        syncState={study.syncState} onRetrySaves={study.resolveSyncFailures} />
    );
  }

  const { card, pinyin } = current;
  const answerLang = mode === "pinyin" ? "zh-Latn-pinyin" : chineseLang;

  return (
    <div className="study-surface mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 pb-safe">
      <SessionHeader backHref={backHref} study={study} action={
        <HardWordButton key={`${card.deckId}:${card.id}`} card={card} onChange={(hard) => study.setHard(card, hard)} />
      } />

      <div className="flashcard flex flex-col px-5 py-6 sm:px-8">
        <p className="eyebrow text-center">{mode === "pinyin" ? "Write Pinyin" : "Write Chinese"}</p>
        <div className="mt-3 text-center">
          <span lang={mode === "pinyin" ? chineseLang : "zh-Latn-pinyin"} className="selectable text-4xl font-medium break-words sm:text-5xl">
            {prompt.prompt}
          </span>
          {mode === "write" && pinyin && (
            <div className="mt-2 flex flex-col items-center gap-1">
              <button type="button" onClick={() => setShowEnglish((visible) => !visible)} className="btn btn-ghost text-sm">
                {showEnglish ? "Hide English" : "Show English"}
              </button>
              {showEnglish && <p className="selectable text-base text-muted">{pinyin.meaning}</p>}
            </div>
          )}
        </div>

        <label className="mt-6 block text-sm font-medium text-muted" htmlFor="write-input">
          {mode === "pinyin" ? "Type the Pinyin" : "Write the Chinese"}
        </label>
        <input
          id="write-input"
          ref={inputRef}
          lang={mode === "pinyin" ? "en" : chineseLang}
          aria-describedby={mode === "pinyin" ? "pinyin-input-help" : undefined}
          inputMode="text"
          maxLength={mode === "pinyin" ? 10_000 : undefined}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onInputKeyDown}
          readOnly={!!result}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint={result ? "next" : "go"}
          placeholder={result ? "" : mode === "pinyin" ? "e.g. ni3 hao3" : "输入中文…"}
          className={`input mt-2 py-3 text-center text-2xl ${
            result ? (result.correct ? "!border-green-600/70" : "!border-red-500/70") : ""
          }`}
        />
        {mode === "pinyin" && (
          <div className="mt-3 space-y-1.5 text-sm text-muted">
            <label className="flex w-fit items-center gap-2">
              <input type="checkbox" checked={checkTones} onChange={(event) => setCheckTones(event.target.checked)}
                disabled={!!result} className="checkbox" />
              Check tones
            </label>
            <p id="pinyin-input-help" className="text-xs">
              {checkTones ? "Use tone marks or numbers: nǐ hǎo or ni3 hao3." : "Tones are optional: ni hao is accepted."}
              {" "}Use ü, v, or u: for ü. Neutral tones can be blank, 0, or 5.
            </p>
          </div>
        )}
        <label className="mt-3 flex w-fit items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={repeatMistakes} disabled={drillFailed || !!result} className="checkbox"
            onChange={(event) => {
              const enabled = event.target.checked;
              setRepeatMistakes(enabled);
              try { localStorage.setItem(REPEAT_MISTAKES_KEY, String(enabled)); } catch {}
            }} />
          Write missed words correctly 3 more times
        </label>

        {/* Result area: reserved so checking doesn't shift the layout. */}
        <div aria-live="polite" className="mt-5 flex min-h-36 flex-col items-center justify-start gap-2 text-center">
          {drillFailed && (
            <p role="status" className="rounded-full bg-accent/10 px-3 py-1 text-sm font-medium text-accent">
              {copiesLeft > 0
                ? `${CORRECTION_COPIES - copiesLeft}/${CORRECTION_COPIES} correct repetitions · ${copiesLeft} left`
                : "3/3 complete. The original miss will be remembered for your next review."}
            </p>
          )}
          {result ? (
            <div key={card.id} className="reveal-in flex flex-col items-center gap-2">
              {result.correct ? (
                <p className="flex items-center gap-1.5 text-lg font-semibold text-green-600 dark:text-green-400">
                  <IconCheck strokeWidth={2.5} /> Correct
                </p>
              ) : (
                <>
                  <p className="flex items-center gap-1.5 text-lg font-semibold text-red-500">
                    <IconX strokeWidth={2.5} /> Incorrect
                  </p>
                  {result.typed.length > 0 && (
                    <p className="text-sm text-muted">
                      Your answer:{" "}
                      <span lang={answerLang} className="selectable text-2xl break-all">
                        {result.typed.map((c, i) => (
                          <span key={i} className={c.ok ? "text-foreground" : "rounded bg-red-500/15 text-red-500"}>
                            {c.char}
                          </span>
                        ))}
                      </span>
                    </p>
                  )}
                </>
              )}
              <div className="flex items-center gap-2">
                <span lang={answerLang} className={`selectable break-words ${mode === "pinyin" ? "text-3xl" : "text-4xl"}`}>
                  {result.expected.map((c, i) => (
                    <span key={i} className={result.correct || c.ok ? "" : "rounded bg-green-500/15 text-green-700 dark:text-green-400"}>
                      {c.char}
                    </span>
                  ))}
                </span>
                <TtsButton text={mode === "pinyin" ? prompt.prompt : prompt.answer} lang={chineseLang} />
              </div>
              {mode === "pinyin" && pinyin && (
                <>
                  <p className="selectable text-sm text-muted">{numberedPinyin(pinyin.syllables)}</p>
                  <p className="selectable text-base">{pinyin.meaning}</p>
                  <p className="max-w-sm text-xs text-muted">If a word has another valid reading, choose your own rating.</p>
                </>
              )}
              {mode === "write" && pinyin && !showEnglish && (
                <p className="selectable text-base text-muted">{pinyin.meaning}</p>
              )}
              {prompt.notes && <p className="selectable text-sm text-muted">{prompt.notes}</p>}
            </div>
          ) : (
            <span className="text-xs text-muted">Enter ↵ to check</span>
          )}
        </div>
      </div>

      {/* Bottom bar keeps one height in both phases. */}
      <div className="flex min-h-28 items-center gap-2 py-3">
        {result && (copiesLeft > 0 || drillFailed) ? (
          <button type="button" onClick={continueWriting} className="btn btn-primary btn-lg w-full">
            {copiesLeft > 0 ? `Write again (${copiesLeft} left)` : `Continue · review in ${previewIntervals(card.fsrs, new Date(), mode).again}`}
          </button>
        ) : result ? (
          <RatingBar fsrs={card.fsrs} mode={mode} onRate={rate} defaultValue={defaultRating} />
        ) : (
          <>
            <button type="button" onClick={() => check(true)} className="btn btn-secondary btn-lg px-4 text-base text-muted">
              Don&apos;t know
            </button>
            <button type="button" onClick={() => check()} disabled={!value.trim()} className="btn btn-primary btn-lg flex-1">
              Check answer
            </button>
          </>
        )}
      </div>
    </div>
  );
}
