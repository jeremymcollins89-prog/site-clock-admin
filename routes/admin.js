const { getPayPeriod } = require("../utils/payPeriod");
// GET /api/admin/overview
// One row per employee: current clocked-in status (with job/location if
// working), plus regular (in-town) vs travel hours for the current pay
// period. This is the dashboard landing view.
router.get("/overview", async (req, res) => {
  const period = getPayPeriod(new Date());
  const result = await db.query(
    `SELECT
       e.id, e.name, e.active,
       open_te.id AS open_entry_id,
       open_te.job_name AS open_job_name,
       open_te.location_type AS open_location_type,
       open_te.clock_in AS open_clock_in,
       COALESCE(SUM(d.worked_seconds) FILTER (WHERE d.location_type = 'in_town'), 0) AS regular_seconds,
       COALESCE(SUM(d.worked_seconds) FILTER (WHERE d.location_type = 'traveling'), 0) AS travel_seconds
     FROM employees e
     LEFT JOIN time_entries open_te ON open_te.employee_id = e.id AND open_te.clock_out IS NULL
     LEFT JOIN time_entry_durations d ON d.employee_id = e.id
       AND d.clock_in >= $1 AND d.clock_in <= $2
     GROUP BY e.id, e.name, e.active, open_te.id, open_te.job_name, open_te.location_type, open_te.clock_in
     ORDER BY e.active DESC, e.name`,
    [period.start, period.end]
  );
  res.json({ period, employees: result.rows });
});

module.exports = router;