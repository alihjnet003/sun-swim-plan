import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessageCircle, X, Check, Copy, MapPin, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInput, PromptInputTextarea, PromptInputFooter, PromptInputSubmit } from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { cn } from "@/lib/utils";

const WHATSAPP = "97333338208";
const BENEFIT = "33338208";
const MAPS_URL = "https://maps.app.goo.gl/R2MNAkCgdvFsQqn49?g_st=com.google.maps.preview.copy";

function QuickActions({ lang }: { lang: "ar" | "en" }) {
  const [copied, setCopied] = useState(false);

  async function copyBenefit() {
    try {
      await navigator.clipboard.writeText(BENEFIT);
    } catch {
      const el = document.createElement("textarea");
      el.value = BENEFIT;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const label = {
    ar: { wa: "تواصل واتساب", copy: copied ? "تم النسخ ✓" : `انسخ رقم بنفت (${BENEFIT})`, map: "الموقع" },
    en: { wa: "WhatsApp us", copy: copied ? "Copied ✓" : `Copy BenefitPay (${BENEFIT})`, map: "Location" },
  }[lang];

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button
        size="sm"
        className="h-8 gap-1.5 rounded-full text-xs"
        onClick={() =>
          window.open(
            `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(
              lang === "ar" ? "مرحباً، أرغب في الاستفسار عن الحجز" : "Hi, I'd like to ask about a booking",
            )}`,
            "_blank",
            "noopener",
          )
        }
      >
        <MessageCircle className="size-3.5" /> {label.wa}
      </Button>
      <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-full text-xs" onClick={copyBenefit}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {label.copy}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-8 gap-1.5 rounded-full text-xs"
        onClick={() => window.open(MAPS_URL, "_blank", "noopener")}
      >
        <MapPin className="size-3.5" /> {label.map}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-8 gap-1.5 rounded-full text-xs"
        onClick={() => window.open("https://privatepool.edgeone.app/", "_blank", "noopener")}
      >
        <CalendarDays className="size-3.5" /> {lang === "ar" ? "تفاصيل وصور" : "Details & photos"}
      </Button>
    </div>
  );
}


const T = {
  ar: {
    title: "مساعد الحجوزات",
    open: "اسأل عن الحجوزات",
    placeholder: "اسأل عن الفترات المتاحة، الأسعار، الموقع...",
    hello: "أهلاً بك 👋 اسألني عن الفترات المتاحة، الأسعار، الموقع، أو طريقة تثبيت الحجز.",
    thinking: "جاري الكتابة...",
    suggestions: ["الفترات المتاحة هذا الأسبوع", "كم السعر؟", "وين الموقع؟", "كيف أثبت الحجز؟"],
  },
  en: {
    title: "Booking assistant",
    open: "Ask about bookings",
    placeholder: "Ask about availability, prices, location...",
    hello: "Hi 👋 Ask me about available sessions, prices, the location, or how to confirm a booking.",
    thinking: "Thinking...",
    suggestions: ["Availability this week", "What are the prices?", "Where is it located?", "How do I confirm?"],
  },
} as const;

export function PoolChatBot({ lang }: { lang: "ar" | "en" }) {
  const t = T[lang];
  const dir = lang === "ar" ? "rtl" : "ltr";
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/public/chat" }),
  });
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (open && !busy) textareaRef.current?.focus();
  }, [open, busy]);

  function send(text: string) {
    const value = text.trim();
    if (!value || busy) return;
    setInput("");
    void sendMessage({ text: value });
  }

  return (
    <>
      {!open && (
        <Button
          onClick={() => setOpen(true)}
          className="fixed bottom-4 end-4 z-50 shadow-lg rounded-full h-12 px-5 gap-2"
        >
          <MessageCircle className="size-5" /> {t.open}
        </Button>
      )}

      {open && (
        <div
          dir={dir}
          className={cn(
            "fixed z-50 bg-card border shadow-2xl flex flex-col",
            "inset-x-0 bottom-0 top-16 rounded-t-2xl",
            "sm:inset-auto sm:bottom-4 sm:end-4 sm:top-auto sm:w-[380px] sm:h-[560px] sm:rounded-2xl",
          )}
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">🏊</span>
              <span className="font-semibold text-sm">{t.title}</span>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} aria-label="close">
              <X className="size-4" />
            </Button>
          </div>

          <Conversation className="flex-1 min-h-0">
            <ConversationContent className="gap-3">
              {messages.length === 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">{t.hello}</p>
                  <div className="flex flex-wrap gap-2">
                    {t.suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="rounded-full border px-3 py-1.5 text-xs hover:bg-accent transition"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <Message key={m.id} from={m.role}>
                  <MessageContent
                    className={cn(
                      m.role === "assistant" && "bg-transparent p-0 text-foreground",
                      m.role === "user" && "bg-primary text-primary-foreground",
                    )}
                  >
                    <MessageResponse>
                      {m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}
                    </MessageResponse>
                    {m.role === "assistant" && i === messages.length - 1 && !busy && (
                      <QuickActions lang={lang} />
                    )}
                  </MessageContent>
                </Message>
              ))}

              {status === "submitted" && <Shimmer className="text-sm">{t.thinking}</Shimmer>}
              {error && (
                <p className="text-xs text-destructive">
                  {lang === "ar" ? "تعذّر الاتصال، حاول مرة أخرى." : "Connection failed, please try again."}
                </p>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <div className="p-3 border-t">
            <PromptInput
              onSubmit={(_msg, e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <PromptInputTextarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t.placeholder}
              />
              <PromptInputFooter className="justify-end">
                <PromptInputSubmit status={status} disabled={!input.trim() || busy} />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      )}
    </>
  );
}
