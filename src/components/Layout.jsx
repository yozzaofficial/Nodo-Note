import { Outlet } from "react-router-dom";
import "./../css/layout.css";
import ProfileMenu from "./ProfileMenu.jsx";
import Menu from "./Menu";

export default function Layout() {
  return (
    <>
      <header className="mainHeader">
        <h1>NodoNote</h1>
        <ProfileMenu imgClassName="profile-icon" />
      </header>

      <Outlet />

      <Menu />
    </>
  );
}
