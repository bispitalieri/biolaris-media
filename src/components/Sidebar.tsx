import {NavLink} from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faExchangeAlt, faCompressAlt } from "@fortawesome/free-solid-svg-icons";

const Sidebar = () => {

  return (
    <aside className="w-64 border-r border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-600 font-bold">T</div>
        <div>
          <h1 className="text-lg font-bold tracking-tight">Biolaris Media</h1>
          <p className="text-xs text-zinc-500">Locale</p>
        </div>
      </div>
      <nav className="px-3">
        <div className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Media</div>
        <NavLink
          to="/convert"
          className={({isActive}) => `mb-1 flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}
        >
          <FontAwesomeIcon icon={faExchangeAlt} className="w-4"/>
          <span>Convert</span>
        </NavLink>
        <NavLink
          to="/compress"
          className={({isActive}) => `flex items-center gap-2 w-full rounded-lg px-3 py-2 text-left text-sm transition ${isActive ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-900'}`}
        >
          <FontAwesomeIcon icon={faCompressAlt} className="w-4"/>
          <span>Compress</span>
        </NavLink>
      </nav>
      <div className="mt-auto px-6 py-4">
        <span className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-400">Offline</span>
      </div>
    </aside>
  );
}

export default Sidebar;
