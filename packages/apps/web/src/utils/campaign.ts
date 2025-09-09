export const getCampaignStatusColor = (status: string): string => {
  switch (status) {
    case "active":
      return "#22c55e";
    case "preview":
      return "#3b82f6";
    case "creating":
    case "processing":
      return "#f59e0b";
    case "failed":
      return "#ef4444";
    case "paused":
      return "#6b7280";
    case "completed":
      return "#10b981";
    default:
      return "#e5e7eb";
  }
};

export const getPriorityLabel = (priority: number): string => {
  const labels: Record<number, string> = {
    1: "🔴 Urgent",
    2: "🟠 High",
    3: "🟡 Med-High",
    4: "🟢 Medium",
    5: "🔵 Normal",
    6: "⚪ Low",
    7: "⚫ Very Low",
  };
  return labels[priority] || `Priority ${priority}`;
};

export const getFrequencyLabel = (frequency: string): string => {
  const labels: Record<string, string> = {
    daily: "Daily",
    every2days: "Every 2 Days",
    "3weekly": "3x Weekly",
  };
  return labels[frequency] || frequency;
};

export const getStyleLabel = (style: string): string => {
  const labels: Record<string, string> = {
    modern: "Modern & Minimalist",
    vibrant: "Vibrant & Colorful",
    professional: "Professional & Corporate",
    casual: "Casual & Friendly",
    luxury: "Luxury & Premium",
    vintage: "Vintage & Retro",
  };
  return labels[style] || style;
};
