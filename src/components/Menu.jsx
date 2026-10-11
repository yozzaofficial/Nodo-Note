import { NavLink } from "react-router-dom";
import Icon from "./Icon.jsx";

const items = [
  { to: "/", icon: "home", label: "Home", end: true },
  { to: "/tasks", icon: "checklist", label: "Tasks" },
  { to: "/settings", icon: "settings", label: "Settings" },
];

export default function Menu() {
  return (
    <div className="mainFooter">
      <ul className="menu">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) => `menu-link${isActive ? " menu-link-active" : ""}`}
            >
              {({ isActive }) => <Icon name={item.icon} size={26} filled={isActive} />}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
