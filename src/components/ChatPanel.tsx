"use client";

import { useRef, useEffect, useState } from "react";
import ChatMessage from "./ChatMessage";
import SensitivityBar from "./ProbabilityBar";
import ProfileCard from "./PhenotypeCard";
import { ChatMessage as ChatMessageType, AxisScores, SensitivityProfile, FlareRecord } from "@/lib/types";
import { DIMENSION_KEYS } from "@/lib/constants";
import FlareHistoryCards from "./FlareHistoryCards";

interface Props {
  messages: ChatMessageType[];
  axisScores: AxisScores;
  sensitivityProfile: SensitivityProfile | null;
  onSend: (message: string) => void;
  isLoading: boolean;
  flareCount: number;
  converged: boolean;
  flareHistory: FlareRecord[];
}

export default function ChatPanel({
  messages,
  axisScores,
  sensitivityProfile,
  onSend,
  isLoading,
  flareCount,
  converged,
  flareHistory,
}: Props) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSend(input.trim());
    setInput("");
  };

  const hasScores = DIMENSION_KEYS.some((key) => (axisScores as unknown as Record<string, number>)[key] !== 0.5);

  return (
    <div className="flex flex-col h-full glass-panel rounded-r-none">
      {/* Header */}
      <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl tracking-widest text-white">
            GUTMAP
          </h1>
          <p className="text-[11px] text-white/40 mt-1 tracking-wide">
            IBS Trigger Discovery
          </p>
        </div>
        {flareCount > 0 && (
          <div className="px-3 py-1.5 rounded-full bg-[#C084FC]/15 border border-[#C084FC]/30">
            <span className="text-[10px] font-medium tracking-wider text-[#C084FC]">
              {flareCount} FLARE{flareCount > 1 ? "S" : ""} ON FILE
            </span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="text-center text-white/20 text-sm mt-20">
            {flareCount > 0 ? (
              <>
                <p className="font-display text-base mb-2">Welcome back</p>
                <p className="text-xs">
                  You have {flareCount} flare{flareCount > 1 ? "s" : ""} on file.
                  Your history will inform this session.
                </p>
                <FlareHistoryCards history={flareHistory} />
                <p className="text-xs mt-3">Tell me about your latest flare-up.</p>
              </>
            ) : (
              <>
                <p className="font-display text-base mb-2">Describe your symptoms</p>
                <p className="text-xs">Tell me about your most recent flare-up</p>
              </>
            )}
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {isLoading && (
          <div className="flex justify-start mb-3">
            <div className="glass-panel rounded-2xl rounded-bl-md px-4 py-3 text-sm text-white/40">
              <span className="animate-pulse">Thinking...</span>
            </div>
          </div>
        )}
      </div>

      {/* Sensitivity bars */}
      {hasScores && !sensitivityProfile && <SensitivityBar axisScores={axisScores} />}

      {/* Profile card */}
      {sensitivityProfile && <ProfileCard profile={sensitivityProfile} />}

      {/* Post-convergence message */}
      {converged && sensitivityProfile && (
        <div className="px-4 pb-2">
          <p className="text-[11px] text-[#C084FC]/70 text-center">
            Your flare has been mapped. Ask me anything — I&apos;ll draw on others with similar triggers.
          </p>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-white/5">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={converged ? "Ask about your triggers..." : "Describe your symptoms..."}
            disabled={isLoading}
            className="flex-1 bg-transparent border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-[#4ECDC4]/50 transition-colors disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2.5 rounded-lg bg-[#4ECDC4]/20 border border-[#4ECDC4]/30 text-[#4ECDC4] text-sm font-medium hover:bg-[#4ECDC4]/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
