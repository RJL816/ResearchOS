import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { AppSidebar } from "@/components/app-sidebar";
import { Topbar } from "@/components/topbar";
import { ProjectProvider } from "@/components/project-context";
import { ThemeInitScript, ThemeProvider } from "@/components/theme";
import { ToastProvider } from "@/components/toast";
import { CommandPalette } from "@/components/command-palette";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Research OS",
  description: "Personal Research Workspace for AI / ML Researchers",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={cn(
        "h-full",
        "antialiased",
        geistSans.variable,
        geistMono.variable,
        "font-sans",
        inter.variable,
      )}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: ThemeInitScript }} />
      </head>
      <body className="flex h-screen overflow-hidden">
        <ThemeProvider>
          <ToastProvider>
            <Suspense fallback={children}>
              <ProjectProvider>
                <CommandPalette />
                <AppSidebar />
                <div className="flex min-w-0 flex-1 flex-col">
                  <Suspense fallback={<div className="h-[52px] shrink-0 border-b" />}>
                    <Topbar />
                  </Suspense>
                  <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
                </div>
              </ProjectProvider>
            </Suspense>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
