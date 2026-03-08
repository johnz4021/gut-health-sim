"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import ChatPanel from "@/components/ChatPanel";
import FlareGraph from "@/components/FlareGraph";
import { useFlarePolling } from "@/hooks/useFlarePolling";
import { createSession, sendMessage } from "@/lib/api";
import { ChatMessage, PhenotypeMatch } from "@/lib/types";

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [phenotypeProbs, setPhenotypeProbs] = useState<Record<string, number>>(
    {}
  );
  const [converged, setConverged] = useState(false);
  const [phenotypeMatch, setPhenotypeMatch] = useState<PhenotypeMatch | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);

  const { flares, newFlareIds } = useFlarePolling(2000);

  // Create session on mount (guard against strict mode double-mount)
  const sessionCreatedRef = useRef(false);
  useEffect(() => {
    if (sessionCreatedRef.current) return;
    sessionCreatedRef.current = true;
    createSession().then(({ session_id }) => setSessionId(session_id));
  }, []);

  const handleSend = useCallback(
    async (content: string) => {
      if (!sessionId || converged) return;

      // Add user message
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      try {
        const response = await sendMessage(sessionId, content);

        // Add assistant message
        const assistantMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: response.reply,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);

        // Update state
        if (response.phenotype_probs) {
          setPhenotypeProbs(response.phenotype_probs);
        }
        if (response.converged) {
          setConverged(true);
          if (response.phenotype_match) {
            setPhenotypeMatch(response.phenotype_match);
          }
        }
      } catch {
        const errorMsg: ChatMessage = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: "Something went wrong. Please try again.",
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, converged]
  );

  return (
    <main className="flex w-screen h-screen overflow-hidden">
      {/* Chat Panel — 40% */}
      <div className="w-[40%] h-full relative z-10">
        <ChatPanel
          messages={messages}
          phenotypeProbs={phenotypeProbs}
          phenotypeMatch={phenotypeMatch}
          onSend={handleSend}
          isLoading={isLoading}
        />
      </div>

      {/* 3D Force Graph — 60% */}
      <div className="w-[60%] h-full">
        <FlareGraph
          flares={flares}
          newFlareIds={newFlareIds}
          phenotypeProbs={phenotypeProbs}
        />
      </div>
    </main>
  );
}
