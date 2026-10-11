import { HashRouter, Routes, Route } from "react-router-dom";
import "./App.css";
import { AuthProvider } from "./context/AuthContext.jsx";
import RequireAuth from "./components/RequireAuth.jsx";
import AuthPage from "./components/AuthPage.jsx";
import Layout from "./components/Layout";
import Home from "./components/Home";
import TasksPage from "./components/TasksPage";
import Settings from "./components/Settings";
import NoteDetail from "./components/NoteDetail";
import RecordingPage from "./components/RecordingPage";
import AskPage from "./components/AskPage";

function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<AuthPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Home />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route
            path="/note/:id"
            element={
              <RequireAuth>
                <NoteDetail />
              </RequireAuth>
            }
          />
          <Route
            path="/record"
            element={
              <RequireAuth>
                <RecordingPage />
              </RequireAuth>
            }
          />
          <Route
            path="/ask"
            element={
              <RequireAuth>
                <AskPage />
              </RequireAuth>
            }
          />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}

export default App;
