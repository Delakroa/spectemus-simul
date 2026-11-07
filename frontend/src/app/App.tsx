import { Route, Routes } from "react-router-dom";

import { AppShell } from "../components/AppShell";
import { HomePage } from "../pages/HomePage";
import { InternetInvitePage } from "../pages/InternetInvitePage";
import { InternetRoomPage } from "../pages/InternetRoomPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { OperatorDashboardPage } from "../pages/OperatorDashboardPage";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="join" element={<InternetInvitePage />} />
        <Route path="internet/rooms/:publicRoomId" element={<InternetRoomPage />} />
        <Route path="operator" element={<OperatorDashboardPage />} />
        <Route path="rooms/:roomId" element={<HomePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
