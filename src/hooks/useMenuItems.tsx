import {
  AudioLinesIcon,
  BugIcon,
  CalendarClockIcon,
  HomeIcon,
  PowerIcon,
  Settings,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { GithubIcon } from "@/components";

export const useMenuItems = () => {
  const menu: {
    icon: React.ElementType;
    label: string;
    href: string;
    count?: number;
  }[] = [
    {
      icon: HomeIcon,
      label: "Dashboard",
      href: "/dashboard",
    },
    {
      icon: CalendarClockIcon,
      label: "Meetings",
      href: "/meetings",
    },
    {
      icon: Settings,
      label: "Settings",
      href: "/settings",
    },
    {
      icon: AudioLinesIcon,
      label: "Audio Setup",
      href: "/audio",
    },
  ];

  const footerItems = [
    {
      icon: BugIcon,
      label: "Report a bug",
      href: "https://github.com/BalinII/BalinMeettaker/issues/new",
    },
    {
      icon: PowerIcon,
      label: "Quit MinuteSmith",
      action: async () => {
        await invoke("exit_app");
      },
    },
  ];

  const footerLinks: {
    title: string;
    icon: React.ElementType;
    link: string;
  }[] = [
    {
      title: "GitHub",
      icon: GithubIcon,
      link: "https://github.com/BalinII/BalinMeettaker",
    },
  ];

  return {
    menu,
    footerItems,
    footerLinks,
  };
};
