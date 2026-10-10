import {useState} from "react";
import {render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe,it,expect} from "vitest";
import GroupSwitch from "@/components/GroupSwitch";
const tabs=["All","Asia","Europe","US","Last"];
function Groups(){const [tab,setTab]=useState("Asia");return <GroupSwitch tabs={tabs} currentTab={tab} setCurrentTab={setTab}/>;}
describe("group chooser",()=>{
 it("returns to All first, then opens the shared menu and selects any group",async()=>{
  const user=userEvent.setup();render(<Groups/>);
  const all=screen.getByRole("button",{name:"group.all"});
  await user.click(all);expect(all).toHaveAttribute("aria-pressed","true");expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await user.click(all);expect(screen.getByRole("menu")).toBeInTheDocument();
  expect(screen.getAllByRole("menuitemradio")).toHaveLength(5);
  await user.click(screen.getByRole("menuitemradio",{name:"Last"}));
  expect(screen.getByRole("button",{name:"Last"})).toHaveAttribute("aria-pressed","true");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(document.querySelector("[data-group-switch]")).toHaveStyle({"--group-visible-count":"3"});
 });
 it("opens and dismisses from keyboard without changing the current filter",async()=>{
  const user=userEvent.setup();render(<Groups/>);
  const all=screen.getByRole("button",{name:"group.all"});all.focus();
  await user.keyboard("{Enter}");await user.keyboard("{Enter}");
  expect(screen.getByRole("menu")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();expect(all).toHaveFocus();
 });
});
