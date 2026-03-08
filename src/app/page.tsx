"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import ChatPanel from "@/components/ChatPanel";
import FlareGraph from "@/components/FlareGraph";
import { useFlarePolling } from "@/hooks/useFlarePolling";
import { createSession, sendMessage } from "@/lib/api";
import { ChatMessage, AxisScores, SensitivityProfile, FlareNode } from "@/lib/types";
import { CLUSTER_COLORS } from "@/lib/constants";

const DEFAULT_AXIS_SCORES: AxisScores = {
  fodmap: 0.5,
  stress_gut: 0.5,
  caffeine_sleep: 0.5,
};

const DRAFT_NODE_ID = "__draft__";

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [axisScores, setAxisScores] = useState<AxisScores>(DEFAULT_AXIS_SCORES);
  const [converged, setConverged] = useState(false);
  const [chatState, setChatState] = useState<"SYMPTOM_INTAKE" | "QUESTIONING" | "CONVERGED">("SYMPTOM_INTAKE");
  const [sensitivityProfile, setSensitivityProfile] = useState<SensitivityProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const { flares, newFlareIds } = useFlarePolling(2000);

  const draftActive = chatState !== "SYMPTOM_INTAKE" && !converged;
  const draftNodeRef = useRef<FlareNode | null>(null);

  // Create/destroy draft node synchronously so it's available for useMemo
  if (draftActive && !draftNodeRef.current) {
    draftNodeRef.current = {
      id: DRAFT_NODE_ID,
      label: "Analyzing...",
      symptoms: [],
      clusterId: -1,
      color: CLUSTER_COLORS[-1],
      confidence: 0,
      synthetic: false,
    };
  } else if (!draftActive && draftNodeRef.current) {
    draftNodeRef.current = null;
  }

  const mergedFlares = useMemo(() => {
    if (!draftNodeRef.current) return flares;
    return [...flares, draftNodeRef.current];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flares, draftActive, converged]);

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
        if (response.state) {
          setChatState(response.state);
        }
        if (response.axis_scores) {
          setAxisScores(response.axis_scores);
        }
        if (response.converged) {
          setConverged(true);
          if (response.sensitivity_profile) {
            setSensitivityProfile(response.sensitivity_profile);
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
          axisScores={axisScores}
          sensitivityProfile={sensitivityProfile}
          onSend={handleSend}
          isLoading={isLoading}
        />
      </div>

      {/* 3D Force Graph — 60% */}
      <div className="w-[60%] h-full">
        <FlareGraph
          flares={mergedFlares}
          newFlareIds={newFlareIds}
          draftNodeId={draftActive && !converged ? DRAFT_NODE_ID : null}
          axisScores={axisScores}
        />
      </div>
    </main>
  );
}
