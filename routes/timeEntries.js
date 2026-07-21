router.post("/ping-location", async (req, res) => {
  const employee_id = req.employee.employee_id;
  const { lat, lng } = req.body;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "lat and lng are required numbers" });
  }

  const openShift = await db.query(