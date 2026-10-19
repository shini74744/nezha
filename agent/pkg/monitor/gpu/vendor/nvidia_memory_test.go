package vendor

import "testing"

func TestNvidiaMemorySameCollection(t *testing.T) {
	smi := &NvidiaSMI{data: []byte(`<nvidia_smi_log>
<gpu><utilization><gpu_util>33 %</gpu_util></utilization><fb_memory_usage><used>1937 MiB</used><total>6144 MiB</total></fb_memory_usage></gpu>
<gpu><utilization><gpu_util>0 %</gpu_util></utilization><fb_memory_usage><used>0 MiB</used><total>24576 MiB</total></fb_memory_usage></gpu>
<gpu><utilization><gpu_util>12 %</gpu_util></utilization><fb_memory_usage><used>N/A</used><total>N/A</total></fb_memory_usage></gpu>
</nvidia_smi_log>`)}
	stats, err := smi.GatherStat()
	if err != nil || len(stats) != 3 {
		t.Fatalf("stats=%+v err=%v", stats, err)
	}
	if stats[0].Utilization != 33 || stats[0].MemoryUsed != 1937 || stats[0].MemoryTotal != 6144 {
		t.Fatalf("%+v", stats[0])
	}
	if stats[1].MemoryUsed != 0 || stats[1].MemoryTotal != 24576 {
		t.Fatalf("%+v", stats[1])
	}
	if stats[2].Utilization != 12 || stats[2].MemoryTotal != 0 {
		t.Fatalf("%+v", stats[2])
	}
}

func TestNvidiaMemoryInvalidXML(t *testing.T) {
	_, err := (&NvidiaSMI{data: []byte("<broken>")}).GatherStat()
	if err == nil {
		t.Fatal("invalid XML accepted")
	}
}
