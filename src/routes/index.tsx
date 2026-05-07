import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { Dashboard, Settings, Audio, MeetingDetail, Meetings } from "@/pages";
import { DashboardLayout } from "@/layouts";

export default function AppRoutes() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/meetings" element={<Meetings />} />
          <Route path="/meetings/:meetingId" element={<MeetingDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/audio" element={<Audio />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Router>
  );
}
