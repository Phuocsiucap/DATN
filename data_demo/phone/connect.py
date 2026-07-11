import uiautomator2 as u2

d = u2.connect()

print(d(text="Quay").exists)
print(d(description="Quay").exists)
if d(description="Quay").exists:
    d(description="Quay").click()
print(d.dump_hierarchy())