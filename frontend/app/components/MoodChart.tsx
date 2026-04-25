"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type TrendItem = {
  listened_at: string;
  group: string;
};

const GROUP_SCORE: Record<string, number> = {
  positive: 1,
  neutral: 0,
  negative: -1,
};

export default function MoodChart({ trend }: { trend: TrendItem[] }) {
  const data = trend.map((item) => ({
    date: new Date(item.listened_at).toLocaleDateString("ja-JP"),
    score: GROUP_SCORE[item.group] ?? 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <XAxis dataKey="date" stroke="#71717a" tick={{ fontSize: 10 }} />
        <YAxis domain={[-1, 1]} stroke="#71717a" tick={{ fontSize: 10 }} />
        <Tooltip />
        <Line type="monotone" dataKey="score" stroke="#a1a1aa" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
