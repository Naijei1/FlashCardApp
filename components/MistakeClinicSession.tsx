"use client";

import Link from "next/link";
import type { MutableRefObject, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkPinyinAnswer, numberedPinyin } from "@/lib/pinyin";
import { plural } from "@/lib/plural";
import { checkAnswer, diffChars, toWritePrompt, type DiffChar } from "@/lib/write";
import HardWordButton from "./HardWordButton";
import { IconCheck, IconX } from "./icons";
import RatingBar from "./RatingBar";
import { SessionScreen } from "./SessionChrome";
import SyncNotice from "./SyncNotice";
import TtsButton from "./TtsButton";
import { useHandwritingGuard } from "./useHandwritingGuard";
import { useKeepInView } from "./useKeepInView";
import { useKeyboard } from "./useKeyboard";
import { useMistakeClinicQueue } from "./useMistakeClinicQueue";

type DeckLangs = Record<string, { front?: string; back?: string }>;
type Result = { correct: boolean; typed: DiffChar[]; expected: DiffChar[] };

export default function MistakeClinicSession({ deckLangs }: { deckLangs: DeckLangs }) {
  const clinic = useMistakeClinicQueue();
  const current = clinic.current;
  const [revealed, setRevealed] = useState(false);
  const [value, setValue] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [showEnglish, setShowEnglish] = useState(false);
  const [checkTones, setCheckTones] = useState(true);
  const checkedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useKeepInView(inputRef);
  const handwriting = useHandwritingGuard();

  useEffect(() => {
    setRevealed(false);
    setValue("");
    setResult(null);
    setShowEnglish(false);
    checkedRef.current = false;
  }, [current?.card.id, current?.card.deckId, current?.mode]);

  const rate = useCallback((rating: number) => {
    if (!current) return;
    if (current.mode === "review" && !revealed) return;
    if (current.mode !== "review" && !result) return;
    if (!clinic.submitRating(rating)) return;
    setRevealed(false);
    setResult(null);
    setValue("");
    checkedRef.current = false;
    inputRef.current?.focus();
  }, [clinic, current, result, revealed]);

  useKeyboard((event) => {
    if (!current) return;
    if (current.mode === "review") {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (revealed) rate(3);
        else setRevealed(true);
      } else if (revealed && ["1", "2", "3", "4"].includes(event.key)) {
        event.preventDefault();
        rate(Number(event.key));
      }
    } else if (result && ["1", "2", "3", "4"].includes(event.key)) {
      event.preventDefault();
      rate(Number(event.key));
    }
  });

  if (clinic.loadError) {
    return (
      <SessionScreen backHref="/" title="Something went wrong"
        body="Could not load the Mistake Clinic queue." syncState={clinic.syncState}
        onRetrySaves={clinic.resolveSyncFailures} onRetry={clinic.loadQueue} />
    );
  }
  if (clinic.queue === null) {
    return (
      <SessionScreen backHref="/" title="Loading…"
        body={clinic.syncState.pendingCount > 0 ? "Finishing pending reviews before refreshing the clinic." : "Finding the words that need the most attention."}
        syncState={clinic.syncState} onRetrySaves={clinic.resolveSyncFailures} />
    );
  }
  if (!current) {
    const reviewed = clinic.reviewed;
    return (
      <SessionScreen backHref="/" title={reviewed > 0 ? "Clinic complete" : "No weak words yet"}
        body={reviewed > 0 ? `You drilled ${plural(reviewed, "prompt")}.` : "Mistake Clinic fills up after repeated misses, recent lapses, low streaks, or words you mark as hard."}
        syncState={clinic.syncState} onRetrySaves={clinic.resolveSyncFailures} />
    );
  }

  const left = clinic.queue.length;
  const progress = left + clinic.reviewed > 0 ? clinic.reviewed / (left + clinic.reviewed) : 0;
  const modeLabel = current.mode === "review" ? "Recognition" : current.mode === "write" ? "Write Chinese" : "Write Pinyin";

  return (
    <div className="study-surface study-frame mx-auto flex w-full max-w-2xl flex-col px-safe pt-safe pb-safe lg:max-w-3xl">
      <header className="flex items-center gap-3 py-3">
        <Link href="/" className="btn btn-ghost -ml-2 shrink-0 px-3">← Back</Link>
        <div className="min-w-0 flex-1">
          <div className="flex justify-between text-xs tabular-nums text-muted">
            <span>{left} left · {clinic.totalWeak} weak words</span>
            <span>{clinic.reviewed} done</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/70" aria-hidden="true">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
        <HardWordButton key={`${current.card.deckId}:${current.card.id}`} card={current.card} onChange={(hard) => clinic.setHard(current.card, hard)} />
      </header>
      <div className="-mt-1 mb-2 flex flex-wrap items-center justify-center gap-2 text-center">
        <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">{modeLabel}</span>
        {current.weaknessReasons.slice(0, 2).map((reason) => (
          <span key={reason} className="rounded-full bg-surface-muted px-3 py-1 text-xs text-muted">{reason}</span>
        ))}
      </div>
      <SyncNotice state={clinic.syncState} onRetry={clinic.resolveSyncFailures} compact />
      {current.mode === "review" ? (
        <RecognitionPrompt item={current} deckLangs={deckLangs} revealed={revealed} setRevealed={setRevealed} rate={rate} />
      ) : (
        <WritingPrompt item={current} value={value} setValue={setValue} result={result} setResult={setResult}
          showEnglish={showEnglish} setShowEnglish={setShowEnglish} checkTones={checkTones}
          setCheckTones={setCheckTones} checkedRef={checkedRef} inputRef={inputRef}
          handwriting={handwriting} rate={rate} />
      )}
    </div>
  );
}

function RecognitionPrompt({
  item,
  deckLangs,
  revealed,
  setRevealed,
  rate,
}: {
  item: NonNullable<ReturnType<typeof useMistakeClinicQueue>["current"]>;
  deckLangs: DeckLangs;
  revealed: boolean;
  setRevealed: (revealed: boolean) => void;
  rate: (rating: number) => void;
}) {
  const { card, pinyin } = item;
  const frontLang = pinyin ? "zh-CN" : deckLangs[card.deckId]?.front || "zh-CN";
  const backLang = deckLangs[card.deckId]?.back || "en-US";
  const prompt = pinyin?.hanzi ?? card.front;
  const [showEnglish, setShowEnglish] = useState(false);

  return (
    <>
      <div key={card.id} onClick={() => setRevealed(true)} className="flashcard flex min-h-0 flex-1 cursor-pointer flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 basis-1/2 flex-col items-center justify-center gap-3 overflow-y-auto px-6 py-6 text-center">
          <div className="flex items-center gap-2">
            <span lang={frontLang} className="selectable text-5xl leading-tight font-medium break-words sm:text-6xl">{prompt}</span>
            <TtsButton text={prompt} lang={frontLang} />
          </div>
          {pinyin && (
            <div className="flex flex-col items-center gap-1">
              <button type="button" onClick={(event) => { event.stopPropagation(); setShowEnglish((visible) => !visible); }} className="btn btn-ghost text-sm">
                {showEnglish ? "Hide English" : "Show English"}
              </button>
              {showEnglish && <p className="selectable text-base text-muted">{pinyin.meaning}</p>}
            </div>
          )}
        </div>
        <div className="flex min-h-0 flex-1 basis-1/2 flex-col items-center justify-center gap-3 overflow-y-auto border-t border-dashed border-border px-6 py-6 text-center">
          {revealed ? (
            <div key={card.id} className="reveal-in flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">
                <span lang={pinyin ? "zh-Latn-pinyin" : backLang} className="selectable text-3xl break-words text-foreground/90">
                  {pinyin ? pinyin.syllables.join(" ") : card.back}
                </span>
                {!pinyin && <TtsButton text={card.back} lang={backLang} />}
              </div>
              {card.notes && <p className="selectable text-base text-muted">{card.notes}</p>}
            </div>
          ) : (
            <span className="text-sm text-muted">
              <span className="touch-hint">Tap the card to reveal</span>
              <span className="kbd-hint">Click or press Space to reveal · 1–4 to rate</span>
            </span>
          )}
        </div>
      </div>
      <div className="flex min-h-28 shrink-0 items-center py-3">
        {revealed ? <RatingBar fsrs={card.fsrs} onRate={rate} /> : (
          <button type="button" onClick={() => setRevealed(true)} className="btn btn-primary btn-lg w-full">Show answer</button>
        )}
      </div>
    </>
  );
}

function WritingPrompt({
  item,
  value,
  setValue,
  result,
  setResult,
  showEnglish,
  setShowEnglish,
  checkTones,
  setCheckTones,
  checkedRef,
  inputRef,
  handwriting,
  rate,
}: {
  item: NonNullable<ReturnType<typeof useMistakeClinicQueue>["current"]>;
  value: string;
  setValue: (value: string) => void;
  result: Result | null;
  setResult: (result: Result | null) => void;
  showEnglish: boolean;
  setShowEnglish: (showEnglish: boolean | ((showEnglish: boolean) => boolean)) => void;
  checkTones: boolean;
  setCheckTones: (checkTones: boolean) => void;
  checkedRef: MutableRefObject<boolean>;
  inputRef: RefObject<HTMLInputElement | null>;
  handwriting: ReturnType<typeof useHandwritingGuard>;
  rate: (rating: number) => void;
}) {
  const prompt = useMemo(() => {
    if (!item.pinyin) return null;
    if (item.mode === "pinyin") {
      return { prompt: item.pinyin.hanzi, answer: item.pinyin.syllables.join(" "), notes: item.card.notes };
    }
    return item.chineseSide ? toWritePrompt(item.card, item.chineseSide, item.pinyin.syllables) : null;
  }, [item]);

  const check = useCallback((giveUp = false) => {
    if (!prompt || result || checkedRef.current) return;
    checkedRef.current = true;
    const typed = giveUp ? "" : value;
    const correct = item.mode === "pinyin"
      ? checkPinyinAnswer(typed, item.pinyin?.syllables ?? [], checkTones)
      : checkAnswer(typed, prompt.answer);
    const feedback = item.mode === "pinyin"
      ? {
          typed: [...typed].map((char) => ({ char, ok: correct })),
          expected: [...prompt.answer].map((char) => ({ char, ok: correct })),
        }
      : diffChars(typed, prompt.answer);
    setResult({ correct, ...feedback });
  }, [checkTones, checkedRef, item.mode, item.pinyin, prompt, result, setResult, value]);

  if (!prompt) {
    return (
      <div className="study-scroll flashcard flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-6 py-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Nothing writable</h1>
        <p className="text-muted">This prompt no longer has a gradable Mandarin reading.</p>
      </div>
    );
  }

  const defaultRating = result?.correct ? 3 : 1;
  const answerLang = item.mode === "pinyin" ? "zh-Latn-pinyin" : "zh-CN";

  return (
    <>
      <div key={item.card.id} className="study-scroll flashcard flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-6 sm:px-8">
        <p className="eyebrow text-center">{item.mode === "pinyin" ? "Write Pinyin" : "Write Chinese"}</p>
        <div className="mt-3 text-center">
          <span lang={item.mode === "pinyin" ? "zh-CN" : "zh-Latn-pinyin"} className="selectable text-4xl font-medium break-words sm:text-5xl">
            {prompt.prompt}
          </span>
          {item.mode === "write" && item.pinyin && (
            <div className="mt-2 flex flex-col items-center gap-1">
              <button type="button" onClick={() => setShowEnglish((visible) => !visible)} className="btn btn-ghost text-sm">
                {showEnglish ? "Hide English" : "Show English"}
              </button>
              {showEnglish && <p className="selectable text-base text-muted">{item.pinyin.meaning}</p>}
            </div>
          )}
        </div>

        <label className="mt-6 block text-sm font-medium text-muted" htmlFor="clinic-input">
          {item.mode === "pinyin" ? "Type the Pinyin" : "Write the Chinese"}
        </label>
        <input id="clinic-input" ref={inputRef} lang={item.mode === "pinyin" ? "en" : "zh-CN"}
          value={value} onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !result && value.trim()) {
              event.preventDefault();
              check();
            } else if (event.key === "Enter" && result) {
              event.preventDefault();
              rate(defaultRating);
            }
          }}
          {...handwriting.inputProps}
          readOnly={!!result} autoFocus autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
          enterKeyHint={result ? "next" : "go"} placeholder={result ? "" : item.mode === "pinyin" ? "e.g. ni3 hao3" : "输入中文…"}
          className={`input mt-2 min-h-16 py-3 text-center text-2xl ${result ? (result.correct ? "!border-green-600/70" : "!border-red-500/70") : ""}`}
        />
        {item.mode === "pinyin" && (
          <div className="mt-3 space-y-1.5 text-sm text-muted">
            <label className="check-row">
              <input type="checkbox" checked={checkTones} onChange={(event) => setCheckTones(event.target.checked)}
                disabled={!!result} className="checkbox" />
              Check tones
            </label>
            <p className="text-xs">Use tone marks or numbers: nǐ hǎo or ni3 hao3.</p>
          </div>
        )}
        <div aria-live="polite" className="mt-5 flex min-h-36 flex-col items-center justify-start gap-2 text-center">
          {result ? (
            <div className="reveal-in flex flex-col items-center gap-2">
              {result.correct ? (
                <p className="flex items-center gap-1.5 text-lg font-semibold text-green-600 dark:text-green-400"><IconCheck strokeWidth={2.5} /> Correct</p>
              ) : (
                <p className="flex items-center gap-1.5 text-lg font-semibold text-red-500"><IconX strokeWidth={2.5} /> Incorrect</p>
              )}
              {!result.correct && result.typed.length > 0 && (
                <p className="text-sm text-muted">Your answer: <span lang={answerLang} className="selectable text-2xl break-all">{result.typed.map((char, index) => (
                  <span key={index} className={char.ok ? "text-foreground" : "rounded bg-red-500/15 text-red-500"}>{char.char}</span>
                ))}</span></p>
              )}
              <div className="flex items-center gap-2">
                <span lang={answerLang} className={`selectable break-words ${item.mode === "pinyin" ? "text-3xl" : "text-4xl"}`}>
                  {result.expected.map((char, index) => (
                    <span key={index} className={result.correct || char.ok ? "" : "rounded bg-green-500/15 text-green-700 dark:text-green-400"}>{char.char}</span>
                  ))}
                </span>
                <TtsButton text={item.mode === "pinyin" ? prompt.prompt : prompt.answer} lang="zh-CN" />
              </div>
              {item.mode === "pinyin" && item.pinyin && (
                <>
                  <p className="selectable text-sm text-muted">{numberedPinyin(item.pinyin.syllables)}</p>
                  <p className="selectable text-base">{item.pinyin.meaning}</p>
                </>
              )}
              {item.mode === "write" && item.pinyin && !showEnglish && <p className="selectable text-base text-muted">{item.pinyin.meaning}</p>}
              {prompt.notes && <p className="selectable text-sm text-muted">{prompt.notes}</p>}
            </div>
          ) : (
            <span className="text-xs text-muted">
              <span className="touch-hint">Type or write with Apple Pencil, then tap Check answer</span>
              <span className="kbd-hint">Enter ↵ to check</span>
            </span>
          )}
        </div>
      </div>
      <div className="flex min-h-28 shrink-0 items-center gap-2 py-3">
        {result ? <RatingBar fsrs={item.card.fsrs} mode={item.mode} onRate={rate} defaultValue={defaultRating} /> : (
          <>
            <button type="button" {...handwriting.guard(() => check(true))} disabled={handwriting.composing}
              className="btn btn-secondary btn-lg px-4 text-base text-muted">Don&apos;t know</button>
            <button type="button" {...handwriting.guard(() => check())} disabled={!value.trim() || handwriting.composing}
              className="btn btn-primary btn-lg flex-1">Check answer</button>
          </>
        )}
      </div>
    </>
  );
}
