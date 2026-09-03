# Build a New Standalone Task Management System

Create a completely new module inside the existing Operations System named:

**Task Management System**

New path:



This must be developed as a **fully isolated module**.

The existing Operations System, database tables, workflows, APIs, bookings, invoices, movement charts, reports, users, and production data must not be modified or damaged.

The Task Management System should use its **own database tables, models, APIs, authentication-related records, permissions, services, pages, and migrations**.

Do not reuse or modify existing business tables unless they are read-only configuration values and explicitly required.

---

# CRITICAL SAFETY REQUIREMENTS

This is a live production system.

The most important requirement is:

**DO NOT DAMAGE OR MODIFY EXISTING LIVE DATA.**

Create only new Task Management tables with a clear prefix such as:

`tm_users`
`tm_departments`
`tm_teams`
`tm_tasks`
`tm_task_comments`
`tm_task_activity_logs`

and so on.

Never run destructive database commands against the existing database.

Do NOT use:

`migrate:fresh`

`migrate:refresh`

`rollback`

`db:wipe`

`TRUNCATE`

bulk `DELETE`

bulk `UPDATE`

schema reset

database recreation

Do not modify existing production tables.

All migrations must be additive only.

Before creating any migration, inspect existing table names and verify that the new names do not conflict.

Task Management migrations must be individually reversible without touching unrelated tables.

All new foreign keys must reference only Task Management tables unless explicitly approved.

Create defensive backups or schema verification steps where possible before deployment.

Never run automated tests against production data if those tests can write or delete records.

---

# MAIN OBJECTIVE

Build a modern internal productivity platform where Managers, Leaders, and Employees can manage:

* Personal tasks
* Team tasks
* Daily work updates
* Deadlines
* Projects
* Departments
* Team assignments
* Workload
* Productivity
* Task approvals
* Performance analytics
* AI-generated work summaries
* Monthly performance reports
* Reward rankings
* Team health
* Overdue task alerts
* Work history

The system should feel like a combination of:

**Linear + Notion + ClickUp + Monday + modern SaaS dashboard**

but designed specifically for Aahaas internal operations.

The UI must be modern, fast, lightweight, mobile-friendly, and visually clean.

---

# ROUTE STRUCTURE

Main application:

`/tm`

Authentication:

`/tm/login`

`/tm/signup`

`/tm/forgot-password`

`/tm/reset-password`

Main dashboard:

`/tm/dashboard`

Tasks:

`/tm/tasks`

`/tm/tasks/my`

`/tm/tasks/team`

`/tm/tasks/created-by-me`

`/tm/tasks/overdue`

`/tm/tasks/completed`

`/tm/tasks/calendar`

`/tm/tasks/board`

Daily Updates:

`/tm/daily-updates`

`/tm/daily-updates/new`

`/tm/daily-updates/history`

Projects:

`/tm/projects`

Departments:

`/tm/departments`

Teams:

`/tm/teams`

Users:

`/tm/users`

Approvals:

`/tm/approvals`

Performance:

`/tm/performance`

Reports:

`/tm/reports`

Rewards:

`/tm/rewards`

Notifications:

`/tm/notifications`

Profile:

`/tm/profile`

Settings:

`/tm/settings`

Administration:

`/tm/admin`

---

# USER ROLES

There are three main levels.

## 1. Manager

Manager has full access to the Task Management System.

Manager can:

* Create departments
* Edit departments
* Disable departments
* Create teams
* Assign Leaders to teams
* Assign Employees to teams
* Approve signup requests
* Reject signup requests
* Change user role
* Activate/deactivate users
* Create tasks
* Assign tasks to Leaders
* Assign tasks directly to Employees
* Create own personal tasks
* Edit any task
* Reassign any task
* Change deadlines
* Change priorities
* Add task dependencies
* Cancel tasks
* Reopen completed tasks
* View all departments
* View all teams
* View all employees
* View all task history
* View performance analytics
* View daily updates
* View department reports
* View team reports
* View user reports
* Configure performance scoring
* Configure reward rules
* Configure task categories
* Configure priorities
* Export reports
* View audit logs

Manager has full administrative access inside `/tm`.

---

# 2. Leader

Leader controls their assigned team.

Leader can:

* View their team
* View Employees belonging to their team
* Create tasks
* Assign tasks to Employees
* Create own tasks
* Edit tasks created by them
* Update team task deadlines if permitted
* Review Employee daily updates
* Comment on Employee tasks
* Request clarification
* Approve completed tasks
* Reject completed tasks
* Reopen tasks
* View team performance
* View Employee workload
* View overdue tasks
* View upcoming deadlines
* Create recurring team tasks
* View team monthly reports
* View team rewards
* Submit Leader daily updates
* Escalate tasks to Manager

Leader cannot manage another Leader's team unless Manager grants access.

---

# 3. Employee

Employee can:

* View tasks assigned to them
* Create personal tasks
* Update task status
* Add progress updates
* Add comments
* Upload attachments
* Submit completed tasks
* Submit Daily Updates
* View deadlines
* View overdue tasks
* View today's work
* View upcoming tasks
* View personal performance
* View monthly report
* View reward points
* View own activity history

Employees cannot assign tasks to other Employees unless permission is explicitly granted.

---

# SIGNUP WORKFLOW

Users can create their own account.

Signup form must contain:

* Full Name
* Email
* Password
* Confirm Password
* Department
* Team
* Requested Role
* Job Title
* Optional Employee ID
* Profile Photo
* Optional mobile number

Requested roles should normally be:

Leader

Employee

Manager signup should not automatically grant Manager access.

A Manager account must approve roles.

After signup:

Status:

`PENDING_APPROVAL`

User sees:

"Your account is waiting for Manager approval."

Managers receive an approval notification.

Manager can:

Approve

Reject

Change requested role

Change department

Change team

Assign Leader

After approval the user can access the system.

---

# DEFAULT MANAGER ACCOUNT

Create a safe development/default Manager account only if it does not already exist.

Email:

`sasi@aahaas.com`

Password:

`sasi123#`

Role:

`MANAGER`

Status:

`ACTIVE`

IMPORTANT:

Hash the password securely.

Never store plain passwords.

Seed using a safe idempotent seeder.

If this email already exists in the Task Management database, do not overwrite the account.

In production, recommend forcing password change after first login.

---

# DEPARTMENT MANAGEMENT

Manager can create departments such as:

Operations

Accounts

IT

Booking

Customer Experience

Travel Experience

Ground Operations

Marketing

Management

Each department can contain multiple teams.

Department fields:

* Name
* Code
* Description
* Department Manager
* Status
* Created At
* Updated At

---

# TEAM MANAGEMENT

Teams belong to departments.

Example:

Department: IT

Team: Development

Leader: Team Leader

Employees: Developers

Team fields:

* Team Name
* Team Code
* Department
* Leader
* Team Description
* Active Members
* Team Status

Manager can change team Leader without losing task history.

Historical assignments must remain preserved.

---

# TASK CREATION

Task creation must be powerful but simple.

Fields:

Task Title

Task Number

Task Type

Task Description

Project

Department

Team

Assigned To

Created By

Priority

Status

Start Date

Deadline

Estimated Hours

Actual Hours

Progress %

Task Category

Tags

Attachments

Dependencies

Parent Task

Subtasks

Checklist

Recurring Rule

Visibility

Approval Required

Completion Notes

Created At

Updated At

Completed At

Approved At

---

# TASK NUMBER

Automatically generate human-readable IDs.

Example:

`TM-2026-000124`

Optional department-specific IDs:

`TM-IT-2026-0124`

Never reuse a task ID.

---

# TASK PRIORITIES

Use:

Critical

High

Medium

Low

UI should visually differentiate each priority.

---

# TASK STATUSES

Suggested workflow:

Draft

To Do

In Progress

Blocked

Waiting

Review

Completed

Rejected

Cancelled

Overdue

Status history must be saved.

Do not only overwrite the current value.

Create Task Status History.

Track:

Previous Status

New Status

Changed By

Changed At

Reason

---

# TASK DETAIL POPUP / DRAWER

When clicking a task, open a modern side drawer or large modal.

Display:

Task title

Task ID

Task description

Project

Creator

Assignee

Leader

Priority

Status

Progress

Created date

Deadline

Remaining time

Estimated hours

Actual hours

Subtasks

Checklist

Attachments

Comments

Activity timeline

AI summary

Completion notes

Dependencies

Related tasks

Do not force the user to leave the current page.

Allow "Open Full Page" if necessary.

---

# TASK COMMENTS

Support a conversation directly inside the task.

Features:

* User comments
* Mentions using `@name`
* Timestamp
* Edit own comments
* Delete own comment with audit history
* Attachments
* System messages
* AI generated summaries

Example:

"@Sasi API integration completed. Waiting for frontend testing."

Mentioned users should receive notifications.

---

# TASK ACTIVITY TIMELINE

Every important action must be logged.

Examples:

Task created

Assignee changed

Deadline changed

Priority changed

Status changed

Comment added

Attachment uploaded

Progress changed

Subtask completed

Completion submitted

Task approved

Task rejected

Task reopened

Display them as a visual timeline.

---

# SUBTASKS

Tasks should support nested work.

Example:

Main Task:

Build Invoice Dashboard

Subtasks:

* API endpoint
* UI page
* Filters
* Export
* Testing
* Production verification

Each subtask has its own:

Assignee

Status

Deadline

Priority

Progress

---

# TASK CHECKLIST

Allow lightweight checklist items without creating full subtasks.

Example:

☑ Create API

☑ Test response

☐ Mobile UI

☐ Deploy

Automatically calculate completion percentage if desired.

---

# TASK DEPENDENCIES

Allow tasks such as:

Task B cannot start until Task A is completed.

Types:

Blocks

Blocked By

Related To

System should show dependency warnings.

---

# RECURRING TASKS

Support:

Daily

Weekdays

Weekly

Monthly

Custom

Example:

"Send Weekly Operations Report"

Every Saturday.

Automatically generate the next task occurrence.

Recurring task creation must never duplicate the same recurrence instance.

---

# TODAY DASHBOARD

Create a highly useful "Today" view.

Show:

Good Afternoon, [User]

Today's date

Personal productivity score

Today's Tasks

Tasks due today

Overdue Tasks

Upcoming Deadlines

Tasks assigned today

Completed Today

Blocked Tasks

Waiting for Review

Daily Update status

Team workload if Leader

Approvals if Manager

Use modern cards and clean visual hierarchy.

---

# "WHAT SHOULD I DO TODAY?"

Add a dedicated smart section.

Use task priority, deadline, dependencies, estimated effort, overdue status, and workload.

Display recommended order.

Example:

### Recommended Focus

1. Fix B2B Invoice PDF

Reason:

High Priority

Due Today

Blocks 2 other tasks

2. Complete Weekly Report

Reason:

Due in 4 hours

3. Review Client Portal Bug

Reason:

Medium Priority

Due Tomorrow

This prioritization may be powered by deterministic rules first and OpenAI optionally for explanations.

Never allow AI to silently modify task data.

---

# DAILY UPDATE SYSTEM

At the end of each work day every Leader and Employee should submit a Daily Update.

Route:

`/tm/daily-updates/new`

The user can either:

1. Fill structured fields manually

or

2. Paste free-form text / markdown.

Example pasted source:

`DailyUpdated/DAILY_UPDATE_2026-08-18.md`

The system sends the text to OpenAI and intelligently extracts individual work items.

Example pasted text:

"Completed invoice PDF export, fixed report filters, started B2B booking details page and checked pagination issue."

AI should identify separate task items.

---

# AI DAILY UPDATE PARSER

OpenAI should convert unstructured text into structured JSON.

Required fields:

Task Topic

Task Title

Project

Detailed Description

Work Type

Status

Priority

Estimated Progress

Start Time if mentioned

End Time if mentioned

Hours Worked if mentioned

Blockers

Outcome

Related Task if recognizable

Tags

Confidence Score

Example AI result:

Task Topic:

Invoice Report

Project:

Accounts System

Task:

Fix monthly report filters

Details:

Corrected filter logic for monthly reports and verified date ranges.

Status:

Completed

Priority:

High

Progress:

100%

If fields are missing:

AI may intelligently suggest values.

But clearly mark AI-generated fields.

The user must be able to review and edit extracted data before saving.

Never directly save AI output without showing a confirmation/review screen.

---

# DAILY UPDATE REVIEW SCREEN

After AI parsing:

Show extracted tasks as editable cards.

For every card:

Task Title

Project

Description

Status

Progress

Hours

Tags

Related existing task

Create new task?

Update existing task?

User can:

Edit

Remove

Merge

Split

Save

---

# SMART MATCH EXISTING TASK

When parsing a Daily Update, check whether the update relates to an existing task.

Example:

Existing Task:

"Develop B2B Flights Module"

Daily Update:

"Completed booking detail popup and PDF."

System should suggest:

"This appears related to TM-IT-2026-0045."

Options:

Attach Update

Create New Task

Ignore Match

Do not automatically link tasks without user confirmation.

---

# DAILY UPDATE HISTORY

Display previous updates using a timeline.

Filters:

Date

Project

Task

Status

Department

Team

User

Allow Managers and Leaders to view reports according to permissions.

---

# END-OF-DAY WORK SUMMARY

After submission generate a clean summary:

Completed: 5 tasks

In Progress: 2 tasks

Blocked: 1 task

Total recorded work: 7h 25m

Main Projects:

Accounts System

Booking System

Client Portal

AI can create a short professional summary.

---

# MANAGER APPROVAL CENTER

Create:

`/tm/approvals`

Tabs:

User Signups

Task Completion

Deadline Extensions

Task Reassignments

Leave / Availability integrations later

Leader Requests

Each approval must have:

Requester

Request Type

Reason

Submitted At

Approve

Reject

Comment

Audit Trail

---

# TASK COMPLETION APPROVAL

Optional feature configurable per task.

Example workflow:

Employee clicks:

"Submit for Review"

Status:

Review

Leader receives notification.

Leader can:

Approve → Completed

Reject → In Progress

Request Changes → In Progress

Leader comment required when rejecting.

---

# DEADLINE EXTENSION REQUEST

Employees should not silently change important deadlines.

Allow:

Request Extension

Requested Deadline

Reason

Leader / Manager approves.

Maintain original deadline history.

---

# WORKLOAD MANAGEMENT

Leader and Manager dashboards should show workload.

Per person:

Open Tasks

Critical Tasks

Overdue Tasks

Tasks Due Today

Estimated Remaining Hours

Completed This Week

Blocked Tasks

Use visual workload indicators.

Avoid using simplistic task count alone.

A person having one 20-hour task may have more workload than someone with five 30-minute tasks.

---

# CALENDAR VIEW

Create:

`/tm/tasks/calendar`

Views:

Month

Week

Day

Tasks displayed by deadline.

Allow filtering by:

User

Team

Department

Project

Priority

Status

---

# KANBAN BOARD

Create modern drag-and-drop board:

To Do

In Progress

Blocked

Review

Completed

Status updates should be permission controlled.

Persist all changes.

Create audit log for drag-and-drop updates.

---

# LIST VIEW

Support professional table view.

Columns configurable:

Task ID

Task

Project

Assignee

Team

Priority

Status

Progress

Created

Deadline

Remaining

Updated

Support:

Sorting

Filtering

Search

Column picker

Saved views

Pagination

---

# MY TASKS

Employee dashboard sections:

Assigned to Me

Created by Me

Personal Tasks

Due Today

Upcoming

Overdue

Completed

Blocked

---

# PROJECT MANAGEMENT

Create lightweight project management.

Project fields:

Project Name

Project Code

Description

Department

Owner

Leader

Members

Start Date

Target Date

Status

Progress

Tasks

Project statuses:

Planning

Active

On Hold

Completed

Cancelled

Project detail should show:

Overview

Progress

Members

Tasks

Deadlines

Recent activity

AI summary

Risk warnings

---

# PROJECT HEALTH

Automatically calculate project health:

Healthy

Needs Attention

At Risk

Critical

Based on:

Overdue %

Blocked tasks

Critical overdue tasks

Deadline proximity

Completion percentage

Team workload

Show reasons.

---

# NOTIFICATION CENTER

Build in-app notifications.

Types:

New task assigned

Deadline approaching

Task overdue

Comment mention

Task completed

Task rejected

User approval required

Deadline extension request

Daily update reminder

Task reassigned

Leader changed

Project risk warning

Notification center:

`/tm/notifications`

Allow:

Read

Unread

Mark all read

Filter

---

# OPTIONAL EMAIL NOTIFICATIONS

Support configurable email alerts later.

Do not send real emails during development without explicit approval.

Build notification abstraction so email can be enabled safely later.

---

# DEADLINE ALERTS

Notifications:

3 days before deadline

1 day before deadline

3 hours before deadline

Deadline reached

Overdue

Managers/Leaders may configure these defaults.

Avoid notification spam.

---

# MONTHLY PERFORMANCE REPORT

Create:

`/tm/performance`

Employee monthly report should include:

Tasks Assigned

Tasks Completed

Tasks Pending

Tasks Overdue

Completion Rate

Average Completion Time

Deadlines Met

Deadlines Missed

Critical Tasks Completed

Task Rejection Count

Tasks Reopened

Daily Update Completion Rate

Blocked Time

Estimated vs Actual Hours

Comments / Collaboration

Contribution to Projects

Do not judge performance solely by number of tasks.

---

# AI PERFORMANCE ANALYSIS

Use OpenAI to generate an intelligent monthly analysis.

Example:

### Strengths

* Consistently completed high-priority development tasks.
* Strong deadline compliance.
* Good participation across Accounts and Booking projects.

### Areas to Improve

* Several tasks remained in progress for long durations.
* More frequent progress updates could improve transparency.

### Monthly Summary

"Sasi maintained strong delivery performance during August, completing 87% of assigned tasks while handling multiple high-priority projects."

AI must use real calculated metrics.

Never invent achievements.

Send structured metrics to AI.

AI only writes interpretation.

---

# PERFORMANCE SCORE

Create a transparent scoring system.

Example dimensions:

Task Completion

Deadline Reliability

Task Quality

Critical Task Delivery

Consistency

Daily Update Compliance

Collaboration

Task Review Success

Do not create a hidden or unexplained employee ranking algorithm.

Display how scores are calculated.

Managers can configure weights.

Example:

Completion: 25%

Deadline Reliability: 20%

Quality: 20%

Consistency: 15%

Collaboration: 10%

Daily Updates: 10%

---

# MONTHLY POWER REWARD

Create a positive reward feature called:

**Monthly Power Reward**

Possible categories:

Top Performer

Deadline Master

Best Team Player

Most Consistent

Problem Solver

High Impact Contributor

Best Improvement

AI should help explain WHY the person received the reward.

Final reward calculation should primarily depend on measurable metrics, not AI subjective decision-making.

Managers can approve final reward recipients.

---

# LEADERBOARD

Optional internal leaderboard.

Display:

Monthly Points

Rank

Achievement badges

Department

Team

Keep it motivational rather than punitive.

Allow Managers to disable leaderboard visibility.

---

# ACHIEVEMENT BADGES

Examples:

First 10 Tasks

100 Tasks Completed

Zero Overdue Month

Deadline Master

Fast Resolver

Critical Fixer

Consistency Streak

30 Daily Updates

Team Player

Project Finisher

---

# PRODUCTIVITY STREAK

Show:

Daily Update Streak

Deadline Streak

Weekly Task Completion Streak

Do not punish users harshly if no task was assigned.

---

# REPORTING DASHBOARD

Manager report dashboard:

Company Overview

Department Comparison

Team Performance

Task Completion Trend

Overdue Trend

Project Health

Workload Distribution

Daily Update Compliance

Priority Distribution

Task Status Distribution

Reward Leaders

Reports can be filtered by:

Date

Department

Team

Project

Leader

Employee

Priority

Status

---

# EXPORTS

Allow exporting reports as:

CSV

Excel

PDF

Exports must use only Task Management data.

---

# AI WEEKLY SUMMARY

Generate a weekly summary for Managers.

Example:

"This week the Development team completed 41 of 47 planned tasks. Four tasks are overdue, primarily related to the Booking System migration. Two high-risk tasks are blocking three downstream items."

Include:

Achievements

Risks

Overdue items

Project progress

Workload issues

Suggestions

---

# AI TEAM INSIGHTS

Examples:

"Three high-priority tasks are concentrated on one employee."

"Five tasks are blocked by the same API dependency."

"Project X may miss its target deadline."

"Team Y has completed 92% of this week's tasks."

AI recommendations should always be advisory.

Never modify assignments automatically.

---

# SMART SEARCH

Global search inside `/tm`.

Search:

Task ID

Task title

Project

Person

Team

Department

Comment

Tags

Support quick command:

`TM-2026-0125`

and immediately open the task.

---

# COMMAND PALETTE

Add modern keyboard command palette.

Shortcut:

`⌘ + K`

or

`Ctrl + K`

Actions:

Create Task

Search Task

Go to My Tasks

Go to Daily Update

Open Calendar

Open Reports

Search Employee

---

# QUICK ADD TASK

Global button:

`+ New Task`

Accessible from every page.

Quick fields:

Title

Assignee

Deadline

Priority

Then allow "Add More Details."

---

# PERSONAL TASKS

Users should be able to create private personal tasks.

Visibility:

Private

Team

Department

Manager

Only authorized users can see private tasks.

---

# TASK TEMPLATES

Allow Managers and Leaders to create reusable templates.

Example:

Daily Deployment Checklist

Weekly Accounts Report

Client Issue Investigation

New Feature Development

Template includes:

Default checklist

Priority

Estimated duration

Task description

Subtasks

---

# SAVED FILTERS

Users can save task views.

Examples:

"My Critical Tasks"

"Team Overdue"

"Due This Week"

"Accounts Tasks"

---

# FAVORITES

Users can pin:

Tasks

Projects

Reports

Saved Views

---

# USER PROFILE

Profile should show:

Name

Photo

Role

Department

Team

Leader

Joined Date

Tasks Completed

Monthly Score

Rewards

Skills / Tags optional

Recent activity

---

# USER AVAILABILITY

Add work status:

Available

Busy

On Leave

Remote

Offline

This is informational only initially.

Later it can integrate with leave/calendar systems.

Do not connect existing attendance data now.

---

# DARK/LIGHT MODE

Provide:

Light Mode

Dark Mode

System Mode

Use modern design tokens.

---

# UI DESIGN DIRECTION

Use a premium modern SaaS style.

Avoid old Bootstrap-style admin UI.

Design ideas:

Soft backgrounds

Rounded 12-16px cards

Subtle borders

Clean typography

Animated counters

Smooth task drawer

Micro-interactions

Drag-and-drop animation

Progress rings

Clean charts

Gradient accents only where useful

Skeleton loading

Empty-state illustrations

Responsive sidebar

Command palette

Sticky task filters

Hover previews

Use the existing Aahaas brand colors as the core accent while giving `/tm` its own visual identity.

---

# DASHBOARD LAYOUT

Desktop:

Left sidebar

Top search / command bar

Main content

Optional right insight panel

Sidebar:

Overview

My Tasks

Team Tasks

Projects

Daily Updates

Calendar

Reports

Performance

Rewards

Notifications

Administration

Profile

---

# MOBILE EXPERIENCE

The system must work properly on mobile.

Bottom navigation:

Home

Tasks

Add

Updates

Profile

Task creation and status updates must be easy from mobile.

---

# AUDIT LOGGING

Create comprehensive audit logs.

Track:

User login

User approval

Role changes

Task creation

Task deletion

Task updates

Deadline changes

Assignee changes

Performance configuration changes

Reward approval

Project changes

Logs should include:

User

Action

Entity

Entity ID

Old Value

New Value

Timestamp

IP Address if safely available

---

# SOFT DELETE

Never permanently delete important records immediately.

Use soft delete for:

Tasks

Users

Projects

Teams

Comments where applicable

Manager can restore deleted Task Management records.

---

# DATABASE DESIGN

Use new tables only.

Suggested tables:

`tm_users`

`tm_user_sessions`

`tm_departments`

`tm_teams`

`tm_team_members`

`tm_projects`

`tm_project_members`

`tm_tasks`

`tm_task_assignees`

`tm_task_subtasks`

`tm_task_checklists`

`tm_task_dependencies`

`tm_task_comments`

`tm_task_attachments`

`tm_task_status_history`

`tm_task_activity_logs`

`tm_task_templates`

`tm_task_recurring_rules`

`tm_daily_updates`

`tm_daily_update_items`

`tm_daily_update_ai_parses`

`tm_notifications`

`tm_approval_requests`

`tm_performance_snapshots`

`tm_performance_scores`

`tm_rewards`

`tm_reward_assignments`

`tm_saved_views`

`tm_user_preferences`

`tm_audit_logs`

Do not create unnecessary relationships with existing system tables.

---

# DATABASE INDEXING

Add appropriate indexes to:

Task ID

Assignee

Creator

Status

Priority

Deadline

Project ID

Team ID

Department ID

Created At

Completed At

Do not create excessive indexes without analyzing query patterns.

---

# API STRUCTURE

Use isolated API routes such as:

`/api/tm/auth/*`

`/api/tm/users/*`

`/api/tm/tasks/*`

`/api/tm/projects/*`

`/api/tm/teams/*`

`/api/tm/daily-updates/*`

`/api/tm/performance/*`

`/api/tm/reports/*`

`/api/tm/notifications/*`

`/api/tm/ai/*`

Avoid polluting existing APIs.

---

# AUTHENTICATION

Task Management login should be isolated.

Use:

Secure password hashing

HTTP-only secure cookies where appropriate

CSRF protection

Rate limiting

Session expiration

Password reset tokens

Login attempt protection

Do not store passwords in logs.

Do not return password hashes through APIs.

---

# ROLE-BASED ACCESS CONTROL

All permissions must be enforced server-side.

Do not rely on hiding buttons in the frontend.

Example:

Employee calling Manager API directly must receive:

`403 Forbidden`

Create centralized RBAC helpers.

Example permissions:

`tm.task.create`

`tm.task.assign`

`tm.task.edit_any`

`tm.task.approve`

`tm.user.approve`

`tm.team.manage`

`tm.report.company`

---

# AI INTEGRATION

Use OpenAI for:

Daily update parsing

Task extraction

Task description improvement

Weekly summaries

Monthly summaries

Performance interpretation

Project risk explanation

Task prioritization explanation

Duplicate task suggestions

Smart task classification

Never use AI to:

Delete records

Approve users

Change roles

Automatically award employees

Automatically complete tasks

Automatically alter deadlines

Automatically reassign tasks

without explicit human confirmation.

---

# AI USAGE LOG

Create:

`tm_ai_usage_logs`

Track:

Feature

User

Model

Input token count if available

Output token count if available

Timestamp

Success

Failure

Do not store sensitive information unnecessarily.

---

# AI FALLBACK

Task Management System must work even when OpenAI is unavailable.

If AI fails:

User can still submit Daily Update manually.

Reports still display numerical metrics.

Tasks still function normally.

Show:

"AI analysis unavailable. Your data has been saved successfully."

AI must never become a critical dependency for basic task operations.

---

# SEARCH AND FILTER PERFORMANCE

Use server-side pagination.

Avoid loading all tasks at once.

Allow:

20

50

100

items per page.

Use debounced search.

Use indexed queries.

---

# REAL-TIME UX

If feasible, add real-time updates for:

New task assignment

New comment

Status changes

Notifications

Fallback to polling if WebSockets are unavailable.

Do not destabilize the main Operations System for this feature.

---

# EMPTY STATES

Create helpful empty states.

Example:

"No tasks due today. You're all caught up."

"No Daily Update submitted yet."

"No overdue tasks."

"Create your first project."

---

# DASHBOARD WIDGET CUSTOMIZATION

Allow users to customize dashboard widgets later.

Examples:

Today's Tasks

Deadlines

Calendar

Performance

Daily Update

Team Activity

Rewards

---

# ANALYTICS

Track non-sensitive product analytics internally:

Most used page

Task creation trends

Update submission rate

Average task lifetime

Do not store invasive personal analytics.

---

# ACCESSIBILITY

Support:

Keyboard navigation

Visible focus states

Readable color contrast

Tooltips

Accessible forms

Screen reader-friendly labels

---

# PERFORMANCE

Target:

Fast first load

Lazy-load heavy reports

Optimize charts

Use pagination

Avoid unnecessary API calls

Cache read-heavy dashboards where safe

---

# ERROR HANDLING

Never show raw database errors to users.

Example:

Instead of:

`SQLSTATE[23000]`

show:

"Unable to create this task. Please try again."

Log technical details securely server-side.

---

# DEVELOPMENT PHASES

Implement safely in phases.

## Phase 1 — Foundation

* New `/tm` route
* Authentication
* Signup
* Manager approval
* Departments
* Teams
* Users
* RBAC
* New isolated database tables

## Phase 2 — Task Management

* Create tasks
* Assignment
* Status
* Deadlines
* Priority
* Comments
* Subtasks
* Checklist
* Activity history
* My Tasks
* Team Tasks

## Phase 3 — Daily Updates

* Manual Daily Update
* AI text parser
* Extracted task review
* Existing task matching
* Daily Update history

## Phase 4 — Dashboards

* Today view
* Leader dashboard
* Manager dashboard
* Calendar
* Kanban
* Workload

## Phase 5 — Reporting

* Employee reports
* Team reports
* Department reports
* Monthly reports
* Exports

## Phase 6 — Performance & Rewards

* Performance metrics
* Transparent scoring
* Monthly Power Reward
* Badges
* Leaderboard

## Phase 7 — AI Intelligence

* Weekly summary
* Monthly analysis
* Project risks
* Smart prioritization
* Workload insights

---

# FINAL ACCEPTANCE TESTS

Before considering the module complete, verify:

Existing Operations pages still work.

Existing database data remains unchanged.

No existing tables were modified.

No destructive migrations were executed.

`/tm` works independently.

Signup works.

Manager approval works.

Manager role permissions work.

Leader permissions work.

Employee permissions work.

Unauthorized API access is blocked.

Manager can assign Leaders.

Leader can assign Employees.

Manager can assign tasks to anyone.

Leader can assign tasks to own Employees.

Employee can update own tasks.

Personal tasks work.

Deadlines work.

Overdue detection works.

Task history is preserved.

Task comments work.

Subtasks work.

Daily Update works.

AI extraction requires user review before save.

AI failure does not break Daily Update submission.

Monthly metrics are calculated from real data.

AI reports never invent metrics.

Reward calculations are explainable.

Reports can be exported.

Soft delete works.

Audit logs work.

Mobile UI works.

No production data has been lost or altered.

---

# FINAL DEVELOPMENT RULE

Treat the existing Operations System as a protected production system.

Build Task Management as an additive isolated module.

Do not redesign, migrate, reset, or restructure existing modules while implementing this feature.

If any required action could modify existing production data, authentication behavior, existing database tables, existing user records, external services, or production infrastructure:

**STOP and request approval before performing that action.**

The end result should be a polished, production-quality internal Task Management platform available at:

**https://www.ops.aahaas.com/tm**

with Manager, Leader, and Employee workflows, advanced task management, Daily Updates, AI-assisted structuring, reporting, performance analytics, and Monthly Power Rewards while keeping the existing Operations System completely safe.
