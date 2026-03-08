"use client";

import { motion } from "framer-motion";
import { ChatMessage as ChatMessageType } from "@/lib/types";

interface Props {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: Props) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}
    >
      <div
        className={`max-w-[85%] px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-teal-900/30 border border-teal-500/20 rounded-2xl rounded-br-md"
            : "glass-panel rounded-2xl rounded-bl-md"
        }`}
      >
        {message.content}
      </div>
    </motion.div>
  );
}
