"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import ChatPanel from "@/components/ChatPanel";
import FlareGraph from "@/components/FlareGraph";
import { useFlarePolling } from "@/hooks/useFlarePolling";
import { createSession, sendMessage, fetchUserProfile } from "@/lib/api";
import NodeDetailPanel from "@/components/NodeDetailPanel";
import { ChatMessage, AxisScores, SensitivityProfile, FlareNode, FlareRecord } from "@/lib/types";
import { DEFAULT_NOISE_COLOR } from "@/lib/constants";

const DEFAULT_AXIS_SCORES: AxisScores = {
  diet_fodmap: 0.5,
  meal_mechanics: 0.5,
  stress_anxiety: 0.5,
  sleep_caffeine: 0.5,
  routine_travel: 0.5,
  exercise_recovery: 0.5,
};

const DRAFT_NODE_ID = "__draft__";

function getOrCreateUserId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("gutmap_user_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("gutmap_user_id", id);
  }
  return id;
}

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [axisScores, setAxisScores] = useState<AxisScores>(DEFAULT_AXIS_SCORES);
  const [converged, setConverged] = useState(false);
  const [chatState, setChatState] = useState<"SYMPTOM_INTAKE" | "QUESTIONING" | "ONBOARDING" | "CONVERGED">("SYMPTOM_INTAKE");
  const [sensitivityProfile, setSensitivityProfile] = useState<SensitivityProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [flareCount, setFlareCount] = useState(0);
  const [, setHasBackground] = useState(false);
  const [flareHistory, setFlareHistory] = useState<FlareRecord[]>([]);
  const [selectedNode, setSelectedNode] = useState<FlareNode | null>(null);
  const [showMyFlares, setShowMyFlares] = useState(false);

  const { flares, newFlareIds, clusterMetadata } = useFlarePolling(2000);

  const draftActive = chatState !== "SYMPTOM_INTAKE" && chatState !== "ONBOARDING" && !converged;
  const draftNodeRef = useRef<FlareNode | null>(null);

  // Create/destroy draft node synchronously so it's available for useMemo
  if (draftActive && !draftNodeRef.current) {
    draftNodeRef.current = {
      id: DRAFT_NODE_ID,
      label: "Analyzing...",
      symptoms: [],
      clusterId: -1,
      color: DEFAULT_NOISE_COLOR,
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

  const displayFlares = useMemo(() => {
    if (!showMyFlares || !userId) return mergedFlares;

    // Flares from polling that belong to this user
    const liveUserFlares = mergedFlares.filter(
      (node) => node.user_id === userId || node.id === DRAFT_NODE_ID
    );

    // Convert flareHistory records to FlareNode objects (for past sessions)
    const liveIds = new Set(liveUserFlares.map((n) => n.id));
    const historyNodes: FlareNode[] = flareHistory
      .filter((rec) => !liveIds.has(rec.session_id))
      .map((rec) => ({
        id: rec.session_id,
        label: rec.summary || rec.primary_trigger || "Past flare",
        symptoms: rec.symptoms,
        clusterId: -1,
        color: DEFAULT_NOISE_COLOR,
        confidence: 1,
        synthetic: false,
        summary: rec.summary,
        axis_scores: rec.axis_scores,
        user_id: userId,
        created_at: rec.timestamp,
      }));

    return [...liveUserFlares, ...historyNodes];
  }, [mergedFlares, showMyFlares, userId, flareHistory]);

  // Create session on mount (guard against strict mode double-mount)
  const sessionCreatedRef = useRef(false);
  useEffect(() => {
    if (sessionCreatedRef.current) return;
    sessionCreatedRef.current = true;
    const uid = getOrCreateUserId();
    setUserId(uid);
    createSession(uid).then((res) => {
      setSessionId(res.session_id);
      if (res.flare_count !== undefined) setFlareCount(res.flare_count);
      if (res.has_background !== undefined) setHasBackground(res.has_background);
      if (res.flare_count && res.flare_count > 0) {
        fetchUserProfile(uid).then((profile) => {
          if (profile.flare_history) setFlareHistory(profile.flare_history);
        });
      }
    });
  }, []);

  const handleSend = useCallback(
    async (content: string) => {
      if (!sessionId) return;

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
        const response = await sendMessage(sessionId, content, userId);

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
          setFlareCount((prev) => prev + 1);
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
    [sessionId, userId]
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
          flareCount={flareCount}
          converged={converged}
          flareHistory={flareHistory}
        />
      </div>

      {/* 3D Force Graph — 60% */}
      <div className="w-[60%] h-full relative">
        <button
          onClick={() => setShowMyFlares((v) => !v)}
          className="absolute top-4 left-4 z-20 px-3 py-1.5 text-xs font-medium rounded-md border border-white/20 bg-black/40 backdrop-blur-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors"
        >
          {showMyFlares ? "My Flares" : "Crowd"}
        </button>
        <FlareGraph
          flares={displayFlares}
          newFlareIds={newFlareIds}
          draftNodeId={draftActive && !converged ? DRAFT_NODE_ID : null}
          axisScores={axisScores}
          clusterMetadata={clusterMetadata}
          currentUserId={userId}
          onNodeSelect={setSelectedNode}
        />
        {selectedNode && (
          <NodeDetailPanel
            node={selectedNode}
            clusterMetadata={clusterMetadata}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>
    </main>
  );
}
